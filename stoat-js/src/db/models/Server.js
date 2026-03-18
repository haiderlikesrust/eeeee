import mongoose from 'mongoose';

const fileSchema = new mongoose.Schema({
  _id: String, tag: String, filename: String, metadata: mongoose.Schema.Types.Mixed,
  content_type: String, size: Number, url: String,
}, { _id: false });

const categorySchema = new mongoose.Schema({
  id: String,
  title: String,
  channels: [String],
}, { _id: false });

const roleSchema = new mongoose.Schema({
  _id: String,
  name: String,
  permissions: mongoose.Schema.Types.Mixed,
  colour: String,
  hoist: { type: Boolean, default: false },
  rank: { type: Number, default: 0 },
}, { _id: false });

const serverSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  owner: { type: String, required: true, ref: 'User' },
  name: { type: String, required: true },
  description: String,
  channels: [{ type: String, ref: 'Channel' }],
  categories: [categorySchema],
  roles: { type: mongoose.Schema.Types.Mixed, default: {} },
  default_permissions: { type: Number, default: 64160 },
  icon: fileSchema,
  banner: fileSchema,
  flags: Number,
  nsfw: { type: Boolean, default: false },
  locked: { type: Boolean, default: false },
  word_filter: { type: [String], default: [] },
}, { id: false });

export default mongoose.model('Server', serverSchema);
