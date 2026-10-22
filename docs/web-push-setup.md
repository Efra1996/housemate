# Web push notifications

## What is implemented

- Home offers device-specific activation and deactivation. Permission is requested only after tapping the activation button.
- A minimal native service worker displays the weekly notification and opens Calendar when tapped. It does not cache the app or provide offline access.
- Weekly saving creates one `weeklyNotificationEvents/{weekStart}` record in the same transaction as the tasks. Previews and completion changes do not create events.
- The Cloud Function checks that the event and its tasks were created in the same commit, claims the event, and sends to registered devices. Invalid FCM tokens are removed.
- `pushSubscriptions` is inaccessible to browser Firestore clients. Its callable registration endpoint requires App Check. No login is introduced.
- Notification events are immutable to clients. The local rules preserve the existing access model for all other collections; they do not make the app private.

The supplied public VAPID key is configured. **Activation stays unavailable until the public App Check site key is filled in.** No backend credentials belong in frontend configuration.

## Required Console setup

1. In Google Cloud Console, select `housemate-16-1d` and create a **reCAPTCHA Enterprise website key** suitable for score-based assessment.
2. Authorize `housemate-16-1d.web.app` and `housemate-16-1d.firebaseapp.com` as website domains.
3. In Firebase Console → **App Check**, register the existing web app with the **reCAPTCHA Enterprise** provider and that site key.
4. Copy the **public site key**, not an API secret or service-account key, into `notifications.appCheckSiteKey` in `src/environments/environment.prod.ts`. Leave the development key empty unless local App Check development has deliberately been configured.
5. Confirm Firebase Console → Project settings → Cloud Messaging shows the supplied VAPID key pair. If token registration fails, check that the FCM Registration API is enabled for this project.

Do not enable App Check enforcement for Firestore before deploying the App Check-enabled frontend. Older open tabs and old clients may need a refresh. The callable function enforces App Check independently from its first deployment.

For local development, Firebase supports App Check debug tokens. Register them explicitly in Console; never commit them, print them into shared logs, or enable debug mode in production.

## Validation and deployment

Deployment requires separate approval. Use Node.js 22 for the functions toolchain/runtime. The backend uses the TypeScript compiler already declared in the root project, so install root dependencies as well.

```powershell
npm.cmd ci
npm.cmd ci --prefix functions
npm.cmd run build
npm.cmd run lint
npm.cmd test -- --watch=false
npm.cmd --prefix functions run build
```

Before publishing, recheck the currently deployed Firestore rules and reconcile any changes made since this implementation. The local rules were based on the existing public catch-all rules; they deliberately exclude notification data from that catch-all.

After approval, deploy **in this order** so private token rules exist before device registration becomes available:

```powershell
firebase.cmd deploy --only firestore:rules --project housemate-16-1d
firebase.cmd deploy --only functions:notifications --project housemate-16-1d
firebase.cmd deploy --only hosting --project housemate-16-1d
```

Functions use `europe-southwest1`, matching the Firestore database. Deployment may require enabling Functions, Cloud Build, Artifact Registry, Eventarc and related Google Cloud APIs, and creating the initial Eventarc service agent. Firebase CLI reports any required permissions/setup. Do not broaden IAM roles indiscriminately to bypass deployment errors.

The callable subscription function declares `invoker: 'public'`: its Cloud Run service `setpushsubscription` requires `allUsers` with `roles/run.invoker` so browsers without login can reach App Check validation. A plain HTML HTTP 403 indicates an invocation/IAM problem, not an App Check rejection. The deployment needed this binding repaired on that service only; the event-driven sender was not made public. A request without App Check now receives the expected JSON HTTP 401 and makes no subscription changes.

Artifact Registry cleanup is configured in `europe-southwest1` to remove function build images older than seven days. This does not delete application data or stop deployed functions.

After the updated frontend is working and App Check metrics confirm valid requests, enable **Firestore App Check enforcement** in Console. This reduces scripted abuse of direct writes, including notification-event creation. It is app attestation, not housemate authentication or an authorization boundary. Configure billing alerts; alerts and function instance limits are not spending caps. Review reCAPTCHA Enterprise pricing/allowances as well.

## Real-device acceptance check

1. Open the published app in a supported browser and tap **Activar notificaciones**. Accept the browser permission. No notification is sent merely for subscribing.
2. On iPhone/iPad with iOS/iPadOS 16.4 or later, add the app to the Home Screen first, then enable notifications from the installed app.
3. Save a genuinely unorganized week. Confirm the tasks are saved and the event reports `sent` or `partial` in Firestore. Do not create sample tasks in the live database without explicit approval.
4. Check receipt with the app both visible and in the background. Tap the notification and verify Calendar opens. Browser/OS delivery and background behavior must be checked on actual devices.
5. Confirm previews, cancellation and task completion do not send notifications. Disable notifications on one device and confirm it no longer receives later events.

## Delivery and operational limits

- All subscribed devices receive the same generic message, including the organizer's device. One person can subscribe multiple devices.
- Delivery is best-effort, not instant or guaranteed. Offline delivery expires after 24 hours.
- The sender claims each event before sending and does not automatically retry sends. This avoids ordinary duplicate-trigger sends, but a failure/crash after claiming can lose an alert. `partial`, `failed`, or a stranded `sending` status can require investigation. A successful FCM response means FCM accepted the message, not that the device displayed it.
- Existing weeks are not announced retroactively. Creating an event before the trigger is deployed does not backfill a push notification.
- Recreating deleted tasks for a week retains its existing event and does not send a second announcement. Do not remove event records just to retry; that defeats duplicate protection.
- Device tokens are refreshed on supported app visits. Invalid tokens reported by FCM are removed. Clearing browser storage loses the local subscription preference; clearing site data may also invalidate its push subscription. There is no cross-device preference syncing.
- If App Check, subscription registration, or FCM fails, the rest of the app remains usable. If the atomic weekly save fails (including its event write), the organizer retains its existing failure behavior; it must not report a saved week.

No live rules, functions, App Check settings or Hosting release are changed by building this feature locally.
