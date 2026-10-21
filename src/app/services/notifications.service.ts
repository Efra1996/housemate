import { Injectable, inject, signal } from '@angular/core';
import type { Messaging } from 'firebase/messaging';
import { environment } from '../../environments/environment';
import { FirebaseService } from './firebase.service';

export type NotificationState = 'checking' | 'off' | 'on' | 'blocked' | 'ios' | 'unsupported' | 'unconfigured';

@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly firebase = inject(FirebaseService);
  private readonly storageKey = 'housemate.push-token';
  private messaging: Messaging | null = null;
  readonly state = signal<NotificationState>('checking');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  async refresh(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.state.set(await this.detectState());
      if (this.state() === 'on') await this.registerDevice();
    } catch {
      if (this.state() === 'checking') this.state.set('off');
      this.error.set('No se pudo comprobar la suscripción. Comprueba la conexión y vuelve a intentarlo.');
    } finally {
      this.busy.set(false);
    }
  }

  async enable(): Promise<void> {
    if (this.busy() || !['off', 'blocked'].includes(this.state())) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      // Request immediately in the click handler, before any asynchronous SDK work.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        this.state.set(permission === 'denied' ? 'blocked' : 'off');
        return;
      }
      await this.registerDevice();
      this.state.set('on');
    } catch {
      this.error.set('No se pudieron activar los avisos. Comprueba la conexión y vuelve a intentarlo.');
    } finally {
      this.busy.set(false);
    }
  }

  async disable(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const token = localStorage.getItem(this.storageKey);
      if (token) await this.saveSubscription(token, false);
      localStorage.removeItem(this.storageKey);
      this.state.set('off');
      // Server removal stops sending even if local browser-token deletion fails.
      if (this.messaging) {
        const { deleteToken } = await import('firebase/messaging');
        await deleteToken(this.messaging).catch(() => false);
      }
    } catch {
      this.error.set('No se pudieron desactivar los avisos. Comprueba la conexión y vuelve a intentarlo.');
    } finally {
      this.busy.set(false);
    }
  }

  private async detectState(): Promise<NotificationState> {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const installed = window.matchMedia('(display-mode: standalone)').matches
      || ('standalone' in navigator && navigator.standalone === true);
    if (ios && !installed) return 'ios';
    if (!window.isSecureContext || !('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported';
    const { isSupported } = await import('firebase/messaging');
    if (!await isSupported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    if (!environment.notifications.appCheckSiteKey) return 'unconfigured';
    return Notification.permission === 'granted' && localStorage.getItem(this.storageKey) ? 'on' : 'off';
  }

  private async registerDevice(): Promise<void> {
    const { getMessaging, getToken } = await import('firebase/messaging');
    this.messaging ??= getMessaging(this.firebase.app);
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    const token = await getToken(this.messaging, {
      vapidKey: environment.notifications.vapidKey,
      serviceWorkerRegistration: registration,
    });
    if (!token) throw new Error('No messaging token returned.');
    const previous = localStorage.getItem(this.storageKey);
    if (previous && previous !== token) await this.saveSubscription(previous, false);
    await this.saveSubscription(token, true);
    localStorage.setItem(this.storageKey, token);
  }

  private async saveSubscription(token: string, enabled: boolean): Promise<void> {
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    const save = httpsCallable<{ token: string; enabled: boolean }, { enabled: boolean }>(
      getFunctions(this.firebase.app, 'europe-southwest1'), 'setPushSubscription',
    );
    await save({ token, enabled });
  }
}
