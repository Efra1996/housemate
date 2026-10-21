import { Injectable } from '@angular/core';
import { getApps, initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getFirestore } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class FirebaseService {
  private readonly appName = 'housemate';
  private appCheckInitialized = false;

  get isConfigured(): boolean {
    const apiKey = environment.firebase.apiKey.trim();
    return apiKey !== '' && apiKey !== 'YOUR_FIREBASE_API_KEY' && apiKey !== 'XX';
  }

  // Initialize only when requested; the UI can keep using sample data meanwhile.
  get app(): FirebaseApp {
    if (!this.isConfigured) {
      throw new Error('Firebase is not configured. Set the API key in the active environment file before using FirebaseService.');
    }

    const app = getApps().find((app) => app.name === this.appName)
      ?? initializeApp(environment.firebase, this.appName);
    if (!this.appCheckInitialized && environment.notifications.appCheckSiteKey) {
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(environment.notifications.appCheckSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
      this.appCheckInitialized = true;
    }
    return app;
  }

  get firestore(): Firestore {
    return getFirestore(this.app);
  }
}
