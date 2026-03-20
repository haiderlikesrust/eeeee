import mongoose from 'mongoose';

/** Global Ofeed posts — not tied to servers or channels. */
const ofeedPostSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  author: { type: String, required: true, ref: 'User' },
  content: { type: String, maxlength: 280, default: '' },
  created_at: { type: Date, default: Date.now },
  likes: { type: [String], default: [] },
  repost_of: { type: String, ref: 'OfeedPost', default: null },
  /** Denormalized count of repost rows pointing at this post */
  repost_count: { type: Number, default: 0 },
}, { id: false });

ofeedPostSchema.index({ created_at: -1 });
ofeedPostSchema.index({ repost_of: 1 });

export default mongoose.model('OfeedPost', ofeedPostSchema);
