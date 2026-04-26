const mongoose = require('mongoose');

const DECORATIONS = ['none', 'neon', 'fire', 'rainbow', 'stars', 'glow', 'gold', 'aurora', 'ice', 'shadow'];
const EFFECTS = ['none', 'pulse', 'sparkle', 'wave', 'shake'];

const LinkSchema = new mongoose.Schema(
  {
    label: { type: String, maxlength: 30, default: '' },
    url: { type: String, maxlength: 200, default: '' },
  },
  { _id: false },
);

const UserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 24,
      match: /^[a-z0-9_]+$/,
    },
    displayName: { type: String, required: true, maxlength: 40 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },

    avatarUrl: { type: String, default: '' },
    avatarPublicId: { type: String, default: '' },
    bannerUrl: { type: String, default: '' },
    bannerPublicId: { type: String, default: '' },

    bio: { type: String, default: '', maxlength: 500 },
    color: { type: String, default: '#7c5cff' }, // accent / name color
    bannerColor: { type: String, default: '#1b1f27' }, // fallback when no banner image
    gradientFrom: { type: String, default: '#7c5cff' },
    gradientTo: { type: String, default: '#ff5c8a' },

    decoration: { type: String, enum: DECORATIONS, default: 'none' },
    effect: { type: String, enum: EFFECTS, default: 'none' },

    pronouns: { type: String, default: '', maxlength: 30 },
    status: { type: String, default: '', maxlength: 80 },

    links: { type: [LinkSchema], default: [] },
  },
  { timestamps: true },
);

UserSchema.methods.toPublicJSON = function () {
  return {
    id: this._id.toString(),
    username: this.username,
    displayName: this.displayName,
    avatarUrl: this.avatarUrl,
    bannerUrl: this.bannerUrl,
    bio: this.bio,
    color: this.color,
    bannerColor: this.bannerColor,
    gradientFrom: this.gradientFrom,
    gradientTo: this.gradientTo,
    decoration: this.decoration,
    effect: this.effect,
    pronouns: this.pronouns,
    status: this.status,
    links: (this.links || []).map((l) => ({ label: l.label || '', url: l.url || '' })),
    createdAt: this.createdAt,
  };
};

UserSchema.statics.DECORATIONS = DECORATIONS;
UserSchema.statics.EFFECTS = EFFECTS;

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
