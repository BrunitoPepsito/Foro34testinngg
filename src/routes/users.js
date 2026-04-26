const express = require('express');
const multer = require('multer');
const User = require('../models/User');
const { connectDB } = require('../lib/db');
const { authRequired } = require('../lib/auth');
const { uploadBuffer, getCloudinary } = require('../lib/cloudinary');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const HEX = /^#[0-9a-fA-F]{6}$/;

router.get('/:username', async (req, res) => {
  try {
    await connectDB();
    const user = await User.findOne({ username: String(req.params.username).toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: user.toPublicJSON() });
  } catch (err) {
    console.error('get user failed', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.patch('/me', authRequired, async (req, res) => {
  try {
    await connectDB();
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Not found' });

    const b = req.body || {};
    if (typeof b.displayName === 'string') user.displayName = b.displayName.slice(0, 40);
    if (typeof b.bio === 'string') user.bio = b.bio.slice(0, 500);
    if (typeof b.color === 'string' && HEX.test(b.color)) user.color = b.color;
    if (typeof b.bannerColor === 'string' && HEX.test(b.bannerColor)) user.bannerColor = b.bannerColor;
    if (typeof b.gradientFrom === 'string' && HEX.test(b.gradientFrom)) user.gradientFrom = b.gradientFrom;
    if (typeof b.gradientTo === 'string' && HEX.test(b.gradientTo)) user.gradientTo = b.gradientTo;
    if (typeof b.decoration === 'string' && User.DECORATIONS.includes(b.decoration)) {
      user.decoration = b.decoration;
    }
    if (typeof b.effect === 'string' && User.EFFECTS.includes(b.effect)) {
      user.effect = b.effect;
    }
    if (typeof b.pronouns === 'string') user.pronouns = b.pronouns.slice(0, 30);
    if (typeof b.status === 'string') user.status = b.status.slice(0, 80);
    if (typeof b.title === 'string') user.title = b.title.slice(0, 30);
    if (typeof b.nameFont === 'string' && User.NAME_FONTS.includes(b.nameFont)) {
      user.nameFont = b.nameFont;
    }
    if (Array.isArray(b.links)) {
      user.links = b.links
        .slice(0, 5)
        .map((l) => ({
          label: typeof l.label === 'string' ? l.label.slice(0, 30) : '',
          url: typeof l.url === 'string' ? l.url.slice(0, 200) : '',
        }))
        .filter((l) => l.url || l.label);
    }

    await user.save();
    res.json({ user: user.toPublicJSON() });
  } catch (err) {
    console.error('update profile failed', err);
    res.status(500).json({ error: 'Update failed' });
  }
});

async function handleMediaUpload(req, res, field) {
  try {
    await connectDB();
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Not found' });

    const cld = getCloudinary();
    const oldId = field === 'avatar' ? user.avatarPublicId : user.bannerPublicId;
    if (oldId) {
      cld.uploader.destroy(oldId).catch((e) => console.warn('cld destroy', e.message));
    }

    // Upload original (no upload-time crop) so animated GIFs / WebP keep
    // their animation. Cloudinary applies size + crop on delivery via URL
    // transformations below, which preserves animation across all frames.
    const result = await uploadBuffer(req.file.buffer, {
      folder: `foro34/${field}s`,
      resource_type: 'image',
    });

    // Generate a delivery URL with size, crop, auto-format, and quality.
    // f_auto serves animated WebP/AVIF where supported; falls back to GIF.
    const transformation =
      field === 'avatar'
        ? [{ width: 256, height: 256, crop: 'fill', gravity: 'auto' }, { quality: 'auto', fetch_format: 'auto' }]
        : [{ width: 1500, height: 500, crop: 'fill' }, { quality: 'auto', fetch_format: 'auto' }];
    const deliveryUrl = cld.url(result.public_id, {
      secure: true,
      resource_type: 'image',
      transformation,
    });

    if (field === 'avatar') {
      user.avatarUrl = deliveryUrl;
      user.avatarPublicId = result.public_id;
    } else {
      user.bannerUrl = deliveryUrl;
      user.bannerPublicId = result.public_id;
    }
    await user.save();
    res.json({ user: user.toPublicJSON() });
  } catch (err) {
    console.error(`upload ${field} failed`, err);
    res.status(500).json({ error: 'Upload failed' });
  }
}

router.post('/me/avatar', authRequired, upload.single('file'), (req, res) =>
  handleMediaUpload(req, res, 'avatar'),
);
router.post('/me/banner', authRequired, upload.single('file'), (req, res) =>
  handleMediaUpload(req, res, 'banner'),
);

module.exports = router;
