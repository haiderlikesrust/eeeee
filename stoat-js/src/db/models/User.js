import mongoose from 'mongoose';

const relationshipSchema = new mongoose.Schema({
  _id: String,
  status: { type: String, enum: ['None', 'User', 'Friend', 'Outgoing', 'Incoming', 'Blocked', 'BlockedOther'] },
}, { _id: false });

const userActivitySchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['Playing', 'Listening', 'Watching', 'Streaming', 'Competing'],
    required: true,
  },
  name: { type: String, maxlength: 128 },
  details: { type: String, maxlength: 128, default: null },
  state: { type: String, maxlength: 128, default: null },
  /** When this activity session started (elapsed timer in clients). */
  started_at: { type: Date, default: null },
  /** HTTPS URL string or attachment-shaped object from /attachments upload. */
  image: { type: mongoose.Schema.Types.Mixed, default: null },
  /** `api` = PATCH /public/v1/presence; legacy values kept for old documents. */
  source: { type: String, enum: ['manual', 'spotify', 'api'], default: 'manual' },
}, { _id: false });

const userStatusSchema = new mongoose.Schema({
  text: String,
  presence: { type: String, enum: ['Online', 'Idle', 'Busy', 'Invisible'], default: 'Invisible' },
  /** Rich presence (Discord-style): Playing X, Listening to Y, etc. */
  activity: { type: userActivitySchema, default: null },
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
  /** Secret for PATCH /public/v1/presence (Bearer or X-Presence-Token). */
  presence_api_token: { type: String, default: null },
  /** When API activity should auto-clear if not refreshed (script stopped). */
  presence_api_expires_at: { type: Date, default: null },
}, { id: false, timestamps: false });

userSchema.index({ username: 1, discriminator: 1 }, { unique: true });
userSchema.index({ presence_api_token: 1 }, { unique: true, sparse: true });
userSchema.index({ presence_api_expires_at: 1 }, { sparse: true });

export default mongoose.model('User', userSchema);
