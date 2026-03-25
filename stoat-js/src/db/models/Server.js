import mongoose from 'mongoose';
import { DEFAULT_EVERYONE_PERMS } from '../../permissions.js';

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

const automodSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  blocked_words: { type: [String], default: [] },
  block_invites: { type: Boolean, default: false },
  max_mentions: { type: Number, default: 0 },
}, { _id: false });

const serverEventSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  location: { type: String, default: '' },
  channel_id: { type: String, default: null },
  starts_at: { type: Date, required: true },
  ends_at: Date,
  creator: { type: String, required: true, ref: 'User' },
  rsvp_yes: { type: [String], default: [] },
  rsvp_no: { type: [String], default: [] },
  rsvp_maybe: { type: [String], default: [] },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { _id: false });

const serverSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  owner: { type: String, required: true, ref: 'User' },
  name: { type: String, required: true },
  description: String,
  channels: [{ type: String, ref: 'Channel' }],
  categories: [categorySchema],
  roles: { type: mongoose.Schema.Types.Mixed, default: {} },
  default_permissions: { type: Number, default: DEFAULT_EVERYONE_PERMS },
  icon: fileSchema,
  banner: fileSchema,
  flags: Number,
  nsfw: { type: Boolean, default: false },
  locked: { type: Boolean, default: false },
  word_filter: { type: [String], default: [] },
  automod: { type: automodSchema, default: () => ({}) },
  events: { type: [serverEventSchema], default: [] },
}, { id: false });

export default mongoose.model('Server', serverSchema);
