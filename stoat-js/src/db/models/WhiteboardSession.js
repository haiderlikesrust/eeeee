import mongoose from 'mongoose';

const whiteboardSessionSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  channel: { type: String, required: true, ref: 'Channel' },
  server: { type: String, required: true, ref: 'Server' },
  owner: { type: String, required: true, ref: 'User' },
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
  closed_at: { type: Date, default: null },
  /** Claw invite message id — updated when session ends so the Join UI can show “ended”. */
  invite_message_id: { type: String, default: null },
}, { id: false, timestamps: { createdAt: 'created_at', updatedAt: false } });

whiteboardSessionSchema.index({ channel: 1, status: 1 });
whiteboardSessionSchema.index({ server: 1, status: 1 });

export default mongoose.model('WhiteboardSession', whiteboardSessionSchema);
