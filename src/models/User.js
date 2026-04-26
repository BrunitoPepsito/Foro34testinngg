const mongoose = require('mongoose');

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
    bio: { type: String, default: '', maxlength: 280 },
    color: { type: String, default: '#7c5cff' },
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
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
