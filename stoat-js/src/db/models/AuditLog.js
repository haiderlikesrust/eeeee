import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  server: { type: String, required: true, index: true },
  user: { type: String, required: true },
  action: { type: String, required: true },
  target_type: String,       // 'User', 'Channel', 'Role', 'Message', 'Server'
  target_id: String,
  detail: mongoose.Schema.Types.Mixed,
  created_at: { type: Date, default: Date.now },
}, { id: false });

auditLogSchema.index({ server: 1, created_at: -1 });
auditLogSchema.index({ created_at: -1 });

export default mongoose.model('AuditLog', auditLogSchema);
