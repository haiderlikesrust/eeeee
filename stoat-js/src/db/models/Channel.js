import mongoose from 'mongoose';

const fileSchema = new mongoose.Schema({
  _id: String, tag: String, filename: String, metadata: mongoose.Schema.Types.Mixed,
  content_type: String, size: Number, url: String,
}, { _id: false });

const channelSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  channel_type: {
    type: String,
    required: true,
    enum: ['SavedMessages', 'DirectMessage', 'Group', 'TextChannel', 'VoiceChannel'],
  },
  // SavedMessages
  user: String,
  // DirectMessage
  active: Boolean,
  recipients: [String],
  last_message_id: String,
  // Group
  name: String,
  owner: String,
  description: String,
  icon: fileSchema,
  permissions: Number,
  nsfw: Boolean,
  // TextChannel
  server: String,
  description: String,
  default_permissions: { type: mongoose.Schema.Types.Mixed, default: null },
  role_permissions: { type: mongoose.Schema.Types.Mixed, default: {} },
  voice: { max_users: Number },
}, { id: false });

channelSchema.index({ server: 1 });
channelSchema.index({ recipients: 1 });

export default mongoose.model('Channel', channelSchema);
