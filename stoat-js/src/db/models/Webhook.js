import mongoose from 'mongoose';

const fileSchema = new mongoose.Schema({
  _id: String, tag: String, filename: String, metadata: mongoose.Schema.Types.Mixed,
  content_type: String, size: Number,
}, { _id: false });

const webhookSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  name: { type: String, required: true },
  avatar: fileSchema,
  creator_id: { type: String, required: true, ref: 'User' },
  channel_id: { type: String, required: true, ref: 'Channel' },
  permissions: { type: Number, default: 0 },
  token: String,
}, { id: false });

webhookSchema.index({ channel_id: 1 });

export default mongoose.model('Webhook', webhookSchema);
