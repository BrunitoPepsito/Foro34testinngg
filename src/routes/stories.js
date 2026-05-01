// Stories — 24h ephemeral image/video posts grouped per author. The Mongo
// TTL index on `expiresAt` cleans up old docs automatically; we also delete
// the Cloudinary asset on explicit delete.
const express = require('express');
const multer = require('multer');
const { authRequired, authOptional } = require('../lib/auth');
const { connectDB } = require('../lib/db');
const Story = require('../models/Story');
const User = require('../models/User');
const { uploadBuffer, getCloudinary } = require('../lib/cloudinary');

const router = express.Router();

// 30 MB cap — stories are short clips/photos, not long-form videos.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } }).single('media');

// GET /api/stories — current active stories, grouped by author. Returns an
// array of `{ author, stories[] }` so the rail can render one bubble per
// user with their latest unseen story leading.
router.get('/', authOptional, async (req, res) => {
  try {
    await connectDB();
    const now = new Date();
    const docs = await Story.find({ expiresAt: { $gt: now } }).sort({ createdAt: 1 }).lean();
    const viewerId = req.user ? req.user.id : null;
    const byUser = new Map();
    for (const d of docs) {
      const uid = (d.author.userId || '').toString();
      if (!uid) continue;
      const seen = viewerId ? (d.viewers || []).some((v) => v.toString() === viewerId) : false;
      const item = {
        id: d._id.toString(),
        mediaUrl: d.mediaUrl,
        mediaType: d.mediaType,
        duration: d.duration,
        width: d.width,
        height: d.height,
        caption: d.caption,
        viewCount: d.viewCount,
        seen,
        createdAt: d.createdAt,
        expiresAt: d.expiresAt,
      };
      if (!byUser.has(uid)) {
        byUser.set(uid, {
          author: {
            userId: uid,
            username: d.author.username,
            displayName: d.author.displayName,
            avatarUrl: d.author.avatarUrl,
            color: d.author.color,
          },
          stories: [],
          allSeen: true,
          latestAt: d.createdAt,
        });
      }
      const entry = byUser.get(uid);
      entry.stories.push(item);
      if (!seen) entry.allSeen = false;
      if (d.createdAt > entry.latestAt) entry.latestAt = d.createdAt;
    }
    // Order: own stories first (if logged in), then unseen authors by latest, then seen by latest.
    const list = [...byUser.values()].sort((a, b) => {
      if (viewerId) {
        if (a.author.userId === viewerId && b.author.userId !== viewerId) return -1;
        if (b.author.userId === viewerId && a.author.userId !== viewerId) return 1;
      }
      if (a.allSeen !== b.allSeen) return a.allSeen ? 1 : -1;
      return new Date(b.latestAt) - new Date(a.latestAt);
    });
    res.json({ groups: list });
  } catch (err) {
    console.error('list stories failed', err);
    res.status(500).json({ error: 'Failed to load stories' });
  }
});

// POST /api/stories — upload + create. multipart with `media` file and
// optional `caption` text.
router.post('/', authRequired, upload, async (req, res) => {
  try {
    await connectDB();
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'Subi un archivo' });
    const isVideo = (req.file.mimetype || '').startsWith('video/');
    const result = await uploadBuffer(req.file.buffer, {
      folder: 'foro34/stories',
      resource_type: isVideo ? 'video' : 'image',
    });
    const u = await User.findById(req.user.id);
    if (!u) return res.status(404).json({ error: 'No user' });
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const story = await Story.create({
      author: {
        userId: u._id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl || '',
        color: u.color || '#7c5cff',
      },
      mediaUrl: result.secure_url,
      mediaType: isVideo ? 'video' : 'image',
      publicId: result.public_id || '',
      duration: Math.round(result.duration || 0),
      width: result.width || 0,
      height: result.height || 0,
      caption: (req.body.caption || '').toString().slice(0, 200).trim(),
      expiresAt,
    });
    res.status(201).json({ story: story.toClientJSON(req.user.id) });
  } catch (err) {
    console.error('create story failed', err);
    res.status(500).json({ error: 'Failed to create story' });
  }
});

// POST /api/stories/:id/view — bump view count once per viewer.
router.post('/:id/view', authOptional, async (req, res) => {
  try {
    await connectDB();
    const s = await Story.findById(req.params.id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    if (req.user) {
      const already = (s.viewers || []).some((v) => v.toString() === req.user.id);
      if (!already && s.author.userId.toString() !== req.user.id) {
        s.viewers.push(req.user.id);
        s.viewCount += 1;
        await s.save();
      }
    } else {
      s.viewCount += 1;
      await s.save();
    }
    res.json({ ok: true, viewCount: s.viewCount });
  } catch (err) {
    res.status(400).json({ error: 'Bad id' });
  }
});

// DELETE /api/stories/:id — author or owner only.
router.delete('/:id', authRequired, async (req, res) => {
  try {
    await connectDB();
    const s = await Story.findById(req.params.id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    if (s.author.userId.toString() !== req.user.id) return res.status(403).json({ error: 'No autorizado' });
    if (s.publicId) {
      try {
        await getCloudinary().uploader.destroy(s.publicId, { resource_type: s.mediaType === 'video' ? 'video' : 'image' });
      } catch (e) { console.warn('cloudinary destroy story', e.message); }
    }
    await s.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: 'Bad id' });
  }
});

module.exports = router;
