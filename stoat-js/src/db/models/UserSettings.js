import mongoose from 'mongoose';

const userSettingsSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  user_id: { type: String, required: true, ref: 'User' },
  key: { type: String, required: true },
  value: { type: String, default: '' },
  updated_at: { type: Date, default: Date.now },
}, { id: false });

userSettingsSchema.index({ user_id: 1, key: 1 }, { unique: true });

export default mongoose.model('UserSettings', userSettingsSchema);
