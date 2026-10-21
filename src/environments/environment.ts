// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

import type { FirebaseOptions } from 'firebase/app';

export const environment = {
  production: false,
  notifications: {
    vapidKey: 'BC4LWN-nUq4dEyXciHf4Fhjl2iyf411tewpb1IChNq8RQo-D5x-TsPtVxtWulQLRvg88lWU7yPHYu1bogqQT9RY',
    appCheckSiteKey: '',
  },
  firebase: {
    // Replace locally before using the Firebase service.
    apiKey: 'AIzaSyBCX6GHPDDfIlRuggRLZojRt8TohivVMHs',
    authDomain: 'housemate-16-1d.firebaseapp.com',
    projectId: 'housemate-16-1d',
    storageBucket: 'housemate-16-1d.firebasestorage.app',
    messagingSenderId: '581420370689',
    appId: '1:581420370689:web:9b446ea7fd868a4c006900',
  } satisfies FirebaseOptions,
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
