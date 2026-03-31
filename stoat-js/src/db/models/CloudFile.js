import mongoose from 'mongoose';

const cloudFileSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  owner: { type: String, required: true, index: true },
  filename: { type: String, required: true },
  content_type: { type: String, default: 'application/octet-stream' },
  size: { type: Number, required: true },
  url: { type: String, required: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  created_at: { type: Date, default: Date.now },
  /** First message this file was sent in (for deep links). */
  channel_id: { type: String, default: null },
  message_id: { type: String, default: null },
  /** Guild server id when channel is a server (or thread) channel; null for @me / DM / group without server. */
  server_id: { type: String, default: null },
}, { id: false, timestamps: false });

cloudFileSchema.index({ owner: 1, created_at: -1 });

export default mongoose.model('CloudFile', cloudFileSchema);
