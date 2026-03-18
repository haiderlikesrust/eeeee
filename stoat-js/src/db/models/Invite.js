import mongoose from 'mongoose';

const inviteSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  channel: { type: String, required: true, ref: 'Channel' },
  creator: { type: String, required: true, ref: 'User' },
  server: { type: String, ref: 'Server' },
  type: { type: String, enum: ['Server', 'Group'], default: 'Server' },
}, { id: false });

// MongoDB already creates a unique index on _id; do not add a custom one.

export default mongoose.model('Invite', inviteSchema);
