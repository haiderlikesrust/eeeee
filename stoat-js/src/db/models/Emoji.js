import mongoose from 'mongoose';

const emojiSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  creator_id: { type: String, required: true, ref: 'User' },
  name: { type: String, required: true },
  parent: { type: mongoose.Schema.Types.Mixed, default: {} },
  animated: { type: Boolean, default: false },
  nsfw: { type: Boolean, default: false },
  url: String,
  content_type: String,
  filename: String,
}, { id: false });

emojiSchema.index({ creator_id: 1 });
emojiSchema.index({ 'parent.id': 1 });

export default mongoose.model('Emoji', emojiSchema);
