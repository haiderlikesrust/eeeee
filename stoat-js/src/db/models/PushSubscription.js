import mongoose from 'mongoose';

const pushSubscriptionSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  user_id: { type: String, required: true, ref: 'User' },
  session_id: String,
  endpoint: { type: String, required: true },
  p256dh: String,
  auth: String,
  created_at: { type: Date, default: Date.now },
}, { id: false });

pushSubscriptionSchema.index({ user_id: 1 });
pushSubscriptionSchema.index({ endpoint: 1 }, { unique: true });

export default mongoose.model('PushSubscription', pushSubscriptionSchema);
