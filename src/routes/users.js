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
    const { displayName, bio, color } = req.body || {};
    if (typeof displayName === 'string') user.displayName = displayName.slice(0, 40);
    if (typeof bio === 'string') user.bio = bio.slice(0, 280);
    if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) user.color = color;
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

    const uploadOpts = {
      folder: `foro34/${field}s`,
      transformation:
        field === 'avatar'
          ? [{ width: 256, height: 256, crop: 'fill', gravity: 'face' }]
          : [{ width: 1500, height: 500, crop: 'fill' }],
    };
    const result = await uploadBuffer(req.file.buffer, uploadOpts);

    if (field === 'avatar') {
      user.avatarUrl = result.secure_url;
      user.avatarPublicId = result.public_id;
    } else {
      user.bannerUrl = result.secure_url;
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
