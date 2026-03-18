import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  channel: { type: String, required: true, ref: 'Channel' },
  author: { type: String, required: true, ref: 'User' },
  webhook: mongoose.Schema.Types.Mixed,
  content: String,
  system: mongoose.Schema.Types.Mixed,
  attachments: [mongoose.Schema.Types.Mixed],
  edited: Date,
  embeds: [mongoose.Schema.Types.Mixed],
  mentions: [String],
  role_mentions: [String],
  replies: [String],
  reactions: { type: Map, of: [String], default: {} },
  masquerade: { name: String, avatar: String },
  pinned: { type: Boolean, default: false },
  flags: Number,
  created_at: { type: Date, default: Date.now },
  link_previews: [{ url: String, title: String, description: String, image: String, site_name: String }],
}, { id: false });

messageSchema.index({ channel: 1, created_at: -1 });

export default mongoose.model('Message', messageSchema);
