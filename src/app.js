const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');

const { authOptional } = require('./lib/auth');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const messageRoutes = require('./routes/messages');
const configRoutes = require('./routes/config');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.use(authOptional);

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      hasMongo: Boolean(process.env.MONGODB_URI),
      hasCloudinary: Boolean(process.env.CLOUDINARY_CLOUD_NAME),
      hasPusher: Boolean(process.env.PUSHER_KEY),
    });
  });

  app.use('/api/config', configRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/messages', messageRoutes);

  // Static files (only used when running the local server; on Vercel these
  // are served directly by the platform via vercel.json routes).
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));

  app.get(['/', '/login', '/register', '/profile', '/u/:username'], (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use((err, _req, res, _next) => {
    console.error('unhandled error', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
