const express = require('express');

const router = express.Router();

// Public config used by the client (Pusher key + cluster are safe to expose).
router.get('/', (_req, res) => {
  res.json({
    pusher: {
      key: process.env.PUSHER_KEY || '',
      cluster: process.env.PUSHER_CLUSTER || '',
      enabled: Boolean(process.env.PUSHER_KEY && process.env.PUSHER_CLUSTER),
    },
  });
});

module.exports = router;
