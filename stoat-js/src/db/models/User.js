import mongoose from 'mongoose';

const relationshipSchema = new mongoose.Schema({
  _id: String,
  status: { type: String, enum: ['None', 'User', 'Friend', 'Outgoing', 'Incoming', 'Blocked', 'BlockedOther'] },
}, { _id: false });

const userStatusSchema = new mongoose.Schema({
  text: String,
  presence: { type: String, enum: ['Online', 'Idle', 'Busy', 'Invisible'], default: 'Invisible' },
}, { _id: false });

const userProfileSchema = new mongoose.Schema({
  // legacy fields (kept for compatibility)
  content: String,
  background: mongoose.Schema.Types.Mixed,
  // v2 profile customization
  bio: String,
  pronouns: String,
  banner: mongoose.Schema.Types.Mixed,
  accent_color: String,
  decoration: String,
  effect: String,
  social_links: [{
    label: String,
    url: String,
  }],
  theme_preset: String,
  badges: [String],
}, { _id: false });

const fileSchema = new mongoose.Schema({
  _id: String,
  tag: String,
  filename: String,
  metadata: mongoose.Schema.Types.Mixed,
  content_type: String,
  size: Number,
  url: String,
}, { _id: false });

const botSchema = new mongoose.Schema({
  owner: String,
}, { _id: false });

const userSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  username: { type: String, required: true },
  discriminator: { type: String, required: true },
  display_name: String,
  avatar: fileSchema,
  relations: [relationshipSchema],
  badges: { type: Number, default: 0 },
  status: userStatusSchema,
  profile: userProfileSchema,
  system_badges: { type: [String], default: [] },
  flags: { type: Number, default: 0 },
  privileged: { type: Boolean, default: false },
  bot: { type: botSchema, default: null },
  last_acknowledged_policy_change: { type: Date, default: () => new Date(0) },
}, { id: false, timestamps: false });

userSchema.index({ username: 1, discriminator: 1 }, { unique: true });

export default mongoose.model('User', userSchema);
