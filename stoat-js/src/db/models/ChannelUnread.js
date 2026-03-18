import mongoose from 'mongoose';

const channelUnreadSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  channel: { type: String, required: true },
  user: { type: String, required: true },
  last_id: String,
  mentions: [String],
}, { id: false });

channelUnreadSchema.index({ channel: 1, user: 1 }, { unique: true });

export default mongoose.model('ChannelUnread', channelUnreadSchema);
