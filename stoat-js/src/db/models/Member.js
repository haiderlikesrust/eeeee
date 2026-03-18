import mongoose from 'mongoose';

const memberSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  server: { type: String, required: true, ref: 'Server' },
  user: { type: String, required: true, ref: 'User' },
  nickname: String,
  avatar: mongoose.Schema.Types.Mixed,
  roles: [String],
  joined_at: { type: Date, default: Date.now },
}, { id: false });

memberSchema.index({ server: 1, user: 1 }, { unique: true });

export default mongoose.model('Member', memberSchema);
