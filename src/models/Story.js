const mongoose = require('mongoose');

// Stories — short-lived (24h) image/video posts that auto-expire.
// MongoDB TTL indexes work on the `expiresAt` field, so we set it explicitly
// at create time. We also denormalize the author info so the feed query
// doesn't need a `.populate()` per story.
const StorySchema = new mongoose.Schema(
  {
    author: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      username: { type: String, required: true },
      displayName: { type: String, default: '' },
      avatarUrl: { type: String, default: '' },
      color: { type: String, default: '#7c5cff' },
    },
    mediaUrl: { type: String, required: true },
    mediaType: { type: String, enum: ['image', 'video'], default: 'image' },
    publicId: { type: String, default: '' }, // Cloudinary public_id for delete
    duration: { type: Number, default: 0 }, // seconds (videos only)
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    caption: { type: String, default: '', maxlength: 200 },
    viewers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    viewCount: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// TTL: Mongo deletes the doc shortly after expiresAt passes (background sweep).
StorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Feed-by-author lookups (group stories per user, latest first).
StorySchema.index({ 'author.userId': 1, createdAt: -1 });

StorySchema.methods.toClientJSON = function toClientJSON(viewerId) {
  const viewers = this.viewers || [];
  const seen = viewerId ? viewers.some((v) => v.toString() === viewerId.toString()) : false;
  return {
    id: this._id.toString(),
    author: {
      userId: this.author.userId ? this.author.userId.toString() : null,
      username: this.author.username,
      displayName: this.author.displayName,
      avatarUrl: this.author.avatarUrl,
      color: this.author.color,
    },
    mediaUrl: this.mediaUrl,
    mediaType: this.mediaType,
    duration: this.duration,
    width: this.width,
    height: this.height,
    caption: this.caption,
    viewCount: this.viewCount,
    seen,
    createdAt: this.createdAt,
    expiresAt: this.expiresAt,
  };
};

module.exports = mongoose.models.Story || mongoose.model('Story', StorySchema);
