import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const accountSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  user_id: { type: String, required: true, unique: true, ref: 'User' },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  verified: { type: Boolean, default: false },
}, { id: false });

accountSchema.pre('save', async function () {
  if (this.isModified('password') && !this.password.startsWith('$2')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
});

export default mongoose.model('Account', accountSchema);
