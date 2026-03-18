import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  author_id: { type: String, required: true, ref: 'User' },
  content: mongoose.Schema.Types.Mixed,
  reason: String,
  created_at: { type: Date, default: Date.now },
}, { id: false });

export default mongoose.model('Report', reportSchema);
