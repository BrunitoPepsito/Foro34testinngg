const Pusher = require('pusher');

let instance = null;

function getPusher() {
  if (instance) return instance;
  const { PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER } = process.env;
  if (!PUSHER_APP_ID || !PUSHER_KEY || !PUSHER_SECRET || !PUSHER_CLUSTER) {
    return null;
  }
  instance = new Pusher({
    appId: PUSHER_APP_ID,
    key: PUSHER_KEY,
    secret: PUSHER_SECRET,
    cluster: PUSHER_CLUSTER,
    useTLS: true,
  });
  return instance;
}

async function broadcast(channel, event, data) {
  const p = getPusher();
  if (!p) return;
  try {
    await p.trigger(channel, event, data);
  } catch (err) {
    console.error('pusher trigger failed', err.message);
  }
}

module.exports = { getPusher, broadcast };
