const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema(
  {
    text: { type: String, default: '', maxlength: 2000 },
    imageUrl: { type: String, default: '' },
    imagePublicId: { type: String, default: '' },
    // Author info denormalized so anonymous messages and historic ones still render
    // even if the user changes their profile.
    author: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      username: { type: String, default: '' },
      displayName: { type: String, required: true },
      avatarUrl: { type: String, default: '' },
      color: { type: String, default: '#7c5cff' },
      decoration: { type: String, default: 'none' },
      effect: { type: String, default: 'none' },
      nameFont: { type: String, default: 'default' },
      anonymous: { type: Boolean, default: true },
    },
    room: { type: String, default: 'global', index: true },
  },
  { timestamps: true },
);

MessageSchema.index({ createdAt: -1 });

MessageSchema.methods.toClientJSON = function () {
  return {
    id: this._id.toString(),
    text: this.text,
    imageUrl: this.imageUrl,
    author: {
      userId: this.author.userId ? this.author.userId.toString() : null,
      username: this.author.username,
      displayName: this.author.displayName,
      avatarUrl: this.author.avatarUrl,
      color: this.author.color,
      decoration: this.author.decoration || 'none',
      effect: this.author.effect || 'none',
      nameFont: this.author.nameFont || 'default',
      anonymous: this.author.anonymous,
    },
    room: this.room,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.models.Message || mongoose.model('Message', MessageSchema);
