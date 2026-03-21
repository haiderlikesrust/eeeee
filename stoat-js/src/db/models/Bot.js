import mongoose from 'mongoose';

const botSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  owner: { type: String, required: true, ref: 'User' },
  token: { type: String, required: true },
  public: { type: Boolean, default: false },
  analytics: { type: Boolean, default: false },
  discoverable: { type: Boolean, default: false },
  intents: { type: Number, default: 0 },
  interactions_url: { type: String, default: '' },
  terms_of_service_url: { type: String, default: '' },
  privacy_policy_url: { type: String, default: '' },
  flags: Number,
  /** Slash command definitions (name unique per bot; cross-bot uniqueness enforced in shared servers). */
  slash_commands: [{
    name: { type: String, required: true },
    description: { type: String, default: '' },
  }],
}, { id: false });

botSchema.index({ owner: 1 });
botSchema.index({ token: 1 }, { unique: true });

export default mongoose.model('Bot', botSchema);
