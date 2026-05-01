// Web Push subscription endpoints. Stores the browser's PushSubscription on
// the user document so the backend can deliver notifications via VAPID even
// when the tab is closed. See `src/lib/webpush.js` for the actual sender.
const express = require('express');
const { authRequired } = require('../lib/auth');
const { connectDB } = require('../lib/db');
const User = require('../models/User');
const { getPublicKey } = require('../lib/webpush');

const router = express.Router();

// Public — clients need this to call PushManager.subscribe().
router.get('/key', (_req, res) => {
  const key = getPublicKey();
  if (!key) return res.status(503).json({ error: 'Push not configured' });
  res.json({ publicKey: key });
});

router.post('/subscribe', authRequired, async (req, res) => {
  try {
    await connectDB();
    const sub = req.body && req.body.subscription;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return res.status(400).json({ error: 'Subscription inv\u00e1lida' });
    }
    const ua = (req.headers['user-agent'] || '').toString().slice(0, 200);
    const u = await User.findById(req.user.id).select('+pushSubscriptions');
    if (!u) return res.status(404).json({ error: 'No user' });
    const existing = (u.pushSubscriptions || []).filter((s) => s.endpoint !== sub.endpoint);
    existing.push({
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      ua,
      createdAt: new Date(),
    });
    // Cap at 10 subscriptions per user (multi-device) — drop oldest first.
    const trimmed = existing.slice(-10);
    u.pushSubscriptions = trimmed;
    await u.save();
    res.json({ ok: true, count: trimmed.length });
  } catch (err) {
    console.error('push subscribe failed', err);
    res.status(500).json({ error: 'Subscribe failed' });
  }
});

router.delete('/subscribe', authRequired, async (req, res) => {
  try {
    await connectDB();
    const endpoint = (req.body && req.body.endpoint) || (req.query && req.query.endpoint);
    if (!endpoint) return res.status(400).json({ error: 'Falta endpoint' });
    const u = await User.findById(req.user.id).select('+pushSubscriptions');
    if (!u) return res.status(404).json({ error: 'No user' });
    u.pushSubscriptions = (u.pushSubscriptions || []).filter((s) => s.endpoint !== endpoint);
    await u.save();
    res.json({ ok: true });
  } catch (err) {
    console.error('push unsubscribe failed', err);
    res.status(500).json({ error: 'Unsubscribe failed' });
  }
});

module.exports = router;
