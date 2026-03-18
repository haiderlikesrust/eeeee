import mongoose from 'mongoose';

const serverBanSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  server: { type: String, required: true, ref: 'Server' },
  user: { type: String, required: true, ref: 'User' },
  reason: String,
  created_at: { type: Date, default: Date.now },
}, { id: false });

serverBanSchema.index({ server: 1, user: 1 }, { unique: true });

export default mongoose.model('ServerBan', serverBanSchema);
