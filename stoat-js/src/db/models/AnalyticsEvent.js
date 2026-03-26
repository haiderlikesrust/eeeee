import mongoose from 'mongoose';
import config from '../../../config.js';

const ttlSec = Number(config.analyticsTtlSeconds) > 0 ? Number(config.analyticsTtlSeconds) : 7776000;

const analyticsEventSchema = new mongoose.Schema(
  {
    received_at: { type: Date, default: Date.now },
    client_ts: { type: Number, default: null },
    source: { type: String, enum: ['client', 'server'], required: true },
    anonymous_id: { type: String, default: null },
    user_id: { type: String, default: null },
    session_id: { type: String, default: null },
    platform: { type: String, default: 'unknown' },
    app_version: { type: String, default: null },
    event: { type: String, required: true },
    props: { type: mongoose.Schema.Types.Mixed, default: undefined },
    client_event_id: { type: String, default: null },
  },
  { id: false },
);

analyticsEventSchema.index({ received_at: 1 }, { expireAfterSeconds: ttlSec });
analyticsEventSchema.index({ user_id: 1, received_at: -1 });
analyticsEventSchema.index({ event: 1, received_at: -1 });
analyticsEventSchema.index(
  { anonymous_id: 1, client_event_id: 1 },
  {
    unique: true,
    partialFilterExpression: {
      client_event_id: { $exists: true, $type: 'string' },
      anonymous_id: { $exists: true, $type: 'string' },
    },
  },
);

export default mongoose.model('AnalyticsEvent', analyticsEventSchema);
