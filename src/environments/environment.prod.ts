import type { FirebaseOptions } from 'firebase/app';

export const environment = {
  production: true,
  notifications: {
    vapidKey: 'BC4LWN-nUq4dEyXciHf4Fhjl2iyf411tewpb1IChNq8RQo-D5x-TsPtVxtWulQLRvg88lWU7yPHYu1bogqQT9RY',
    appCheckSiteKey: '6LcDZfotAAAAAA_RO8g3L_tvLFz66Ahg5KdIdddh',
  },
  firebase: {
    // Replace locally before building for deployment.
    apiKey: 'AIzaSyBCX6GHPDDfIlRuggRLZojRt8TohivVMHs',
    authDomain: 'housemate-16-1d.firebaseapp.com',
    projectId: 'housemate-16-1d',
    storageBucket: 'housemate-16-1d.firebasestorage.app',
    messagingSenderId: '581420370689',
    appId: '1:581420370689:web:9b446ea7fd868a4c006900',
  } satisfies FirebaseOptions,
};
