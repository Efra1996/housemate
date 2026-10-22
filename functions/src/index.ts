import { createHash } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { error as logError } from 'firebase-functions/logger';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

initializeApp();
setGlobalOptions({ region: 'europe-southwest1', maxInstances: 2 });

const database = getFirestore();
const subscriptions = database.collection('pushSubscriptions');
const choreIds = ['bathroom-a', 'bathroom-b', 'kitchen', 'hallway'];
const calendarUrl = 'https://housemate-16-1d.web.app/tabs/calendar';

// App Check attests the client, not the identity of a housemate.
export const setPushSubscription = onCall({
  invoker: 'public',
  enforceAppCheck: true,
  cors: ['https://housemate-16-1d.web.app', 'https://housemate-16-1d.firebaseapp.com'],
}, async (request) => {
  const data: unknown = request.data;
  if (!data || typeof data !== 'object' || !('token' in data) || !('enabled' in data)
    || typeof data.token !== 'string' || !/^[A-Za-z0-9_:\-]{100,4096}$/.test(data.token)
    || typeof data.enabled !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Expected a valid device token and enabled flag.');
  }
  const reference = subscriptions.doc(createHash('sha256').update(data.token).digest('hex'));
  if (data.enabled) {
    await reference.set({ token: data.token, updatedAt: FieldValue.serverTimestamp() });
  } else {
    await reference.delete();
  }
  return { enabled: data.enabled };
});

export const notifyWeekOrganized = onDocumentCreated({
  document: 'weeklyNotificationEvents/{weekStart}',
  retry: false,
}, async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;
  const data = snapshot.data();
  const weekStart = event.params.weekStart;
  const monday = new Date(`${weekStart}T00:00:00Z`);
  const selectedChores: unknown = data['choreIds'];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || !Number.isFinite(monday.getTime())
    || monday.getUTCDay() !== 1 || monday.toISOString().slice(0, 10) !== weekStart
    || data['weekStart'] !== weekStart || !Array.isArray(selectedChores)
    || selectedChores.length < 1 || selectedChores.length > 4
    || new Set(selectedChores).size !== selectedChores.length
    || !selectedChores.every((id: unknown): id is string => typeof id === 'string' && choreIds.includes(id))) {
    logError('Ignored an invalid weekly notification event.', { weekStart });
    return;
  }
  const tasks = await database.getAll(...selectedChores.map((id: string) => database.doc(`tasks/${weekStart}_${id}`)));
  // An event must accompany newly created tasks in the very same commit.
  if (tasks.some((task) => !task.exists || task.get('weekStart') !== weekStart
    || !task.createTime?.isEqual(snapshot.createTime))) {
    logError('Weekly notification event does not match its saved tasks.', { weekStart });
    return;
  }
  const claimed = await database.runTransaction(async (transaction) => {
    const current = await transaction.get(snapshot.ref);
    if (!current.exists || current.get('status')) return false;
    transaction.update(snapshot.ref, { status: 'sending', startedAt: FieldValue.serverTimestamp() });
    return true;
  });
  if (!claimed) return;

  // Claim before sending: duplicate trigger invocations do not send again.
  // A crash after claiming can lose an alert; push delivery is best-effort.
  try {
    let delivered = 0;
    let failed = 0;
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    do {
      const query = subscriptions.orderBy('__name__').limit(500);
      const page = await (cursor ? query.startAfter(cursor) : query).get();
      if (page.empty) break;
      const devices = page.docs.filter((device) => typeof device.get('token') === 'string');
      if (devices.length) {
        const response = await getMessaging().sendEachForMulticast({
          tokens: devices.map((device) => device.get('token') as string),
          data: {
            title: 'Semana organizada',
            body: 'Las tareas de la semana ya están organizadas.',
            weekStart,
            url: calendarUrl,
          },
          webpush: { headers: { TTL: '86400', Urgency: 'normal' } },
        });
        delivered += response.successCount;
        failed += response.failureCount;
        const expired = response.responses.flatMap((result, index) =>
          ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(result.error?.code ?? '')
            ? [devices[index].ref] : []);
        if (expired.length) {
          const batch = database.batch();
          expired.forEach((reference) => batch.delete(reference));
          await batch.commit();
        }
      }
      cursor = page.size === 500 ? page.docs[page.docs.length - 1] : undefined;
    } while (cursor);
    await snapshot.ref.update({ status: failed ? 'partial' : 'sent', delivered, failed, finishedAt: FieldValue.serverTimestamp() });
  } catch {
    await snapshot.ref.update({ status: 'failed', finishedAt: FieldValue.serverTimestamp() });
    logError('Weekly notification sending failed; it will not automatically resend.', { weekStart });
  }
});
