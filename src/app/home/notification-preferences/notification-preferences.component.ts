import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonModal, IonSpinner, IonTitle, IonToolbar } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline, notificationsOffOutline, notificationsOutline } from 'ionicons/icons';
import { NotificationsService } from '../../services/notifications.service';

@Component({
  selector: 'app-notification-preferences',
  templateUrl: './notification-preferences.component.html',
  styleUrls: ['./notification-preferences.component.scss'],
  imports: [IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonModal, IonSpinner, IonTitle, IonToolbar],
})
export class NotificationPreferencesComponent implements OnInit {
  readonly notifications = inject(NotificationsService);
  private readonly destroyRef = inject(DestroyRef);
  readonly dialog = signal<{ title: string; message: string; ios: boolean } | null>(null);
  readonly buttonLabel = computed(() => {
    if (this.notifications.busy() || this.notifications.state() === 'checking') return 'Actualizando notificaciones';
    switch (this.notifications.state()) {
      case 'on': return 'Desactivar notificaciones en este dispositivo';
      case 'off': return 'Activar notificaciones en este dispositivo';
      default: return 'Notificaciones: ver instrucciones e información';
    }
  });

  constructor() {
    addIcons({ notificationsOutline, notificationsOffOutline, closeOutline });
    effect(() => {
      const message = this.notifications.error();
      if (message) this.dialog.set({ title: 'No se pudo completar la operación', message, ios: false });
    });
  }

  ngOnInit(): void {
    void this.notifications.refresh();
    const refresh = () => {
      if (document.visibilityState === 'visible') void this.notifications.refresh();
    };
    document.addEventListener('visibilitychange', refresh);
    this.destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', refresh));
  }

  async toggleNotifications(): Promise<void> {
    if (this.notifications.busy() || this.notifications.state() === 'checking') return;
    if (this.notifications.state() === 'on') {
      await this.notifications.disable();
    } else if (this.notifications.state() === 'off') {
      await this.notifications.enable();
      if (this.notifications.state() === 'blocked') this.showInstructions();
    } else {
      this.showInstructions();
    }
  }

  private showInstructions(): void {
    switch (this.notifications.state()) {
      case 'ios':
        this.dialog.set({ title: 'Activar avisos en iPhone', message: '', ios: true });
        break;
      case 'blocked':
        this.dialog.set({
          title: 'Permitir las notificaciones', ios: false,
          message: 'Abre los ajustes de permisos de este sitio en tu navegador y permite las notificaciones de Housemate. Después, vuelve a la app y toca la campana. Si tu dispositivo también bloquea los avisos, revisa sus ajustes de notificaciones.',
        });
        break;
      default:
        this.dialog.set({
          title: 'Notificaciones no disponibles', ios: false,
          message: this.notifications.state() === 'unsupported'
            ? 'Este navegador no admite estos avisos. Puedes seguir usando Housemate con normalidad.'
            : 'Los avisos no están disponibles en este momento. Puedes seguir usando Housemate con normalidad.',
        });
    }
  }
}
