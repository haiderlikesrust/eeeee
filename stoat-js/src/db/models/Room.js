import mongoose from 'mongoose';

const roomSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  name: { type: String, required: true },
  owner: { type: String, required: true, ref: 'User' },
  members: [{ type: String, ref: 'User' }],
  text_channel: { type: String, ref: 'Channel' },
  voice_channel: { type: String, ref: 'Channel' },
  status: {
    type: String,
    enum: ['active', 'closed'],
    default: 'active',
  },
  invite_code: { type: String, unique: true, sparse: true },
  empty_timeout_ms: { type: Number, default: 5 * 60 * 1000 },
  last_active_at: { type: Date, default: Date.now },
  created_at: { type: Date, default: Date.now },
  closed_at: Date,
}, { id: false });

roomSchema.index({ status: 1, last_active_at: 1 });
roomSchema.index({ invite_code: 1 });
roomSchema.index({ owner: 1 });

export default mongoose.model('Room', roomSchema);
