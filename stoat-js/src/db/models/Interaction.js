import mongoose from 'mongoose';

const interactionSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  token: { type: String, required: true },
  bot: { type: String, required: true, ref: 'Bot' },
  user: { type: String, required: true, ref: 'User' },
  channel: { type: String, required: true, ref: 'Channel' },
  server: { type: String, default: null, ref: 'Server' },
  kind: { type: String, required: true }, // application_command | message_component | modal_submit | context_message | context_user
  command: mongoose.Schema.Types.Mixed,
  component: mongoose.Schema.Types.Mixed,
  values: [String],
  message_id: { type: String, default: null },
  parent_interaction_id: { type: String, default: null },
  acknowledged: { type: Boolean, default: false },
  deferred: { type: Boolean, default: false },
  deferred_ephemeral: { type: Boolean, default: false },
  original_response_message_id: { type: String, default: null },
  pending_modal: mongoose.Schema.Types.Mixed,
  created_at: { type: Date, default: Date.now },
  expires_at: { type: Date, default: () => new Date(Date.now() + (15 * 60 * 1000)) },
}, { id: false });

interactionSchema.index({ token: 1 }, { unique: true });
interactionSchema.index({ bot: 1, created_at: -1 });
interactionSchema.index({ user: 1, created_at: -1 });
interactionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('Interaction', interactionSchema);

