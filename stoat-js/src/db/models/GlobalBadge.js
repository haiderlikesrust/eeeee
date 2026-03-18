import mongoose from 'mongoose';

const fileSchema = new mongoose.Schema({
  _id: String,
  tag: String,
  filename: String,
  metadata: mongoose.Schema.Types.Mixed,
  content_type: String,
  size: Number,
  url: String,
}, { _id: false });

const globalBadgeSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  label: { type: String, required: true },
  description: { type: String, default: '' },
  icon: { type: fileSchema, default: null },
  active: { type: Boolean, default: true },
}, { timestamps: true });

export default mongoose.model('GlobalBadge', globalBadgeSchema);
