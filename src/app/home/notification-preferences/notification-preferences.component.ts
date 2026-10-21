import { Component, DestroyRef, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonModal, IonSpinner, IonTitle, IonToolbar } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline, notificationsOutline } from 'ionicons/icons';
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
  readonly helpOpen = signal(false);

  constructor() {
    addIcons({ notificationsOutline, closeOutline });
  }

  ngOnInit(): void {
    void this.notifications.refresh();
    const refresh = () => {
      if (document.visibilityState === 'visible') void this.notifications.refresh();
    };
    document.addEventListener('visibilitychange', refresh);
    this.destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', refresh));
  }
}
