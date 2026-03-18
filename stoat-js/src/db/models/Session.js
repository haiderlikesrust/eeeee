import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  user_id: { type: String, required: true, ref: 'User' },
  token: { type: String, required: true, unique: true },
  name: String,
  created_at: { type: Date, default: Date.now },
}, { id: false });

sessionSchema.index({ user_id: 1 });

export default mongoose.model('Session', sessionSchema);
