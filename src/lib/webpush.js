// Lazy wrapper around `web-push` so the rest of the app can fire-and-forget
// without worrying about VAPID configuration. Returns silently when keys are
// missing so dev environments don't crash on every notification trigger.

let webpushModule = null;
let configured = false;
let configuredOk = false;

function getWebPush() {
  if (configured) return configuredOk ? webpushModule : null;
  configured = true;
  try {
    // eslint-disable-next-line global-require
    webpushModule = require('web-push');
  } catch (e) {
    console.warn('web-push module not installed:', e && e.message);
    configuredOk = false;
    return null;
  }
  const pub = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const priv = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = (process.env.VAPID_SUBJECT || 'mailto:noreply@foro34.com').trim();
  if (!pub || !priv) {
    console.warn('VAPID keys not set, push notifications disabled');
    configuredOk = false;
    return null;
  }
  try {
    webpushModule.setVapidDetails(subject, pub, priv);
    configuredOk = true;
    return webpushModule;
  } catch (e) {
    console.warn('webpush setVapidDetails failed:', e && e.message);
    configuredOk = false;
    return null;
  }
}

function getPublicKey() {
  return (process.env.VAPID_PUBLIC_KEY || '').trim();
}

// Send a push notification to a single subscription. Returns true on success,
// false on failure (caller may want to delete the subscription on 410 Gone).
async function sendPush(subscription, payload) {
  const wp = getWebPush();
  if (!wp || !subscription) return { ok: false, gone: false };
  try {
    await wp.sendNotification(subscription, JSON.stringify(payload), { TTL: 60 });
    return { ok: true, gone: false };
  } catch (err) {
    const status = err && err.statusCode;
    // 404 / 410 mean the endpoint is no longer valid and we should drop it.
    const gone = status === 404 || status === 410;
    if (!gone) {
      console.warn('webpush send failed:', status, err && err.body);
    }
    return { ok: false, gone };
  }
}

// Send a payload to every subscription stored on `user.pushSubscriptions`.
// Removes subscriptions that come back with `gone: true`.
async function pushToUser(user, payload) {
  if (!user || !Array.isArray(user.pushSubscriptions) || !user.pushSubscriptions.length) return;
  const wp = getWebPush();
  if (!wp) return;
  const survivors = [];
  for (const sub of user.pushSubscriptions) {
    if (!sub || !sub.endpoint) continue;
    // eslint-disable-next-line no-await-in-loop
    const r = await sendPush(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
    );
    if (!r.gone) survivors.push(sub);
  }
  if (survivors.length !== user.pushSubscriptions.length) {
    user.pushSubscriptions = survivors;
    try { await user.save(); } catch (e) { console.warn('save user after push prune', e.message); }
  }
}

module.exports = { getPublicKey, sendPush, pushToUser };
