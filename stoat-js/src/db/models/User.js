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
  /** When true, server owner crown is not shown on this user's avatar (API + all clients). */
  hide_server_owner_crown: { type: Boolean, default: false },
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
  /** Platform-owned bot (e.g. Claw); shows verified badge; not tied to a user app. */
  official: { type: Boolean, default: false },
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
  /** When true, login and API sessions are rejected (admin moderation). */
  disabled: { type: Boolean, default: false },
  disabled_reason: { type: String, default: null },
  bot: { type: botSchema, default: null },
  last_acknowledged_policy_change: { type: Date, default: () => new Date(0) },
  /** Secret for PATCH /public/v1/presence (Bearer or X-Presence-Token). Omit field until set — do not store null (breaks unique index). */
  presence_api_token: { type: String },
  /** When API activity should auto-clear if not refreshed (script stopped). */
  presence_api_expires_at: { type: Date, default: null },
  /** Opic Cloud: total bytes currently stored by this user. */
  cloud_bytes_used: { type: Number, default: 0 },
  /** Opic Cloud: optional per-user quota override (bytes). Omit to use server default. */
  cloud_quota_bytes: { type: Number },
}, { id: false, timestamps: false });

userSchema.index({ username: 1, discriminator: 1 }, { unique: true });
/** Unique only for real tokens; omit field when unset (multiple users without a token). */
userSchema.index(
  { presence_api_token: 1 },
  { unique: true, partialFilterExpression: { presence_api_token: { $type: 'string' } } },
);
userSchema.index({ presence_api_expires_at: 1 }, { sparse: true });

export default mongoose.model('User', userSchema);
