const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const Message = require('../models/Message');
const User = require('../models/User');
const { connectDB } = require('../lib/db');
const { authOptional } = require('../lib/auth');
const { uploadBuffer } = require('../lib/cloudinary');
const { broadcast } = require('../lib/pusher');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const sendLimiter = rateLimit({
  windowMs: 10 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? `u:${req.user.id}` : `ip:${req.ip}`),
});

function makeAnonName(ip) {
  let h = 0;
  for (let i = 0; i < ip.length; i++) h = (h * 31 + ip.charCodeAt(i)) | 0;
  return `Anon-${Math.abs(h) % 9000 + 1000}`;
}

router.get('/', async (req, res) => {
  try {
    await connectDB();
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const before = req.query.before ? new Date(req.query.before) : null;
    const room = req.query.room || 'global';
    const filter = { room };
    if (before && !Number.isNaN(before.getTime())) {
      filter.createdAt = { $lt: before };
    }
    const items = await Message.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    items.reverse();
    res.json({
      messages: items.map((m) => ({
        id: m._id.toString(),
        text: m.text,
        imageUrl: m.imageUrl,
        author: {
          userId: m.author.userId ? m.author.userId.toString() : null,
          username: m.author.username,
          displayName: m.author.displayName,
          avatarUrl: m.author.avatarUrl,
          color: m.author.color,
          anonymous: m.author.anonymous,
        },
        room: m.room,
        createdAt: m.createdAt,
      })),
    });
  } catch (err) {
    console.error('list messages failed', err);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

router.post('/', authOptional, sendLimiter, upload.single('image'), async (req, res) => {
  try {
    await connectDB();
    const text = (req.body.text || '').toString().slice(0, 2000).trim();
    const room = (req.body.room || 'global').toString().slice(0, 40);

    let imageUrl = '';
    let imagePublicId = '';
    if (req.file) {
      const result = await uploadBuffer(req.file.buffer, { folder: 'foro34/messages' });
      imageUrl = result.secure_url;
      imagePublicId = result.public_id;
    }

    if (!text && !imageUrl) {
      return res.status(400).json({ error: 'Empty message' });
    }

    let author;
    if (req.user) {
      const user = await User.findById(req.user.id);
      if (!user) return res.status(401).json({ error: 'User not found' });
      author = {
        userId: user._id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        color: user.color,
        anonymous: false,
      };
    } else {
      const ip = (req.headers['x-forwarded-for'] || req.ip || 'anon').toString().split(',')[0].trim();
      author = {
        userId: null,
        username: '',
        displayName: makeAnonName(ip),
        avatarUrl: '',
        color: '#9aa0aa',
        anonymous: true,
      };
    }

    const msg = await Message.create({ text, imageUrl, imagePublicId, author, room });
    const payload = msg.toClientJSON();
    const broadcastStatus = await broadcast(`room-${room}`, 'message:new', payload);
    res.status(201).json({ message: payload, broadcast: broadcastStatus });
  } catch (err) {
    console.error('send message failed', err);
    res.status(500).json({ error: 'Failed to send' });
  }
});

module.exports = router;
