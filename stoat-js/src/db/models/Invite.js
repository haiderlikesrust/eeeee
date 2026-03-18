import mongoose from 'mongoose';

const inviteSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  channel: { type: String, required: true, ref: 'Channel' },
  creator: { type: String, required: true, ref: 'User' },
  server: { type: String, ref: 'Server' },
  type: { type: String, enum: ['Server', 'Group'], default: 'Server' },
}, { id: false });

inviteSchema.index({ _id: 1 });

export default mongoose.model('Invite', inviteSchema);
