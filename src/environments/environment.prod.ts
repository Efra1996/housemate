import type { FirebaseOptions } from 'firebase/app';

export const environment = {
  production: true,
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
