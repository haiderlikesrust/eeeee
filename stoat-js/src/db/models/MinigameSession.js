import mongoose from 'mongoose';

const guessSchema = new mongoose.Schema({
  user: { type: String, required: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  distance_km: { type: Number, default: 0 },
  score: { type: Number, default: 0 },
}, { _id: false });

const roundSchema = new mongoose.Schema({
  location_idx: { type: Number, required: true },
  pano_id: { type: String, default: '' },
  heading: { type: Number, default: 0 },
  pitch: { type: Number, default: 0 },
  fov: { type: Number, default: 90 },
  guesses: [guessSchema],
  started_at: { type: Date, default: null },
  ended: { type: Boolean, default: false },
}, { _id: false });

const playerSchema = new mongoose.Schema({
  user: { type: String, required: true },
  username: { type: String, default: '' },
  score: { type: Number, default: 0 },
}, { _id: false });

const minigameSessionSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  game_type: { type: String, required: true, default: 'geoguesser' },
  channel: { type: String, required: true },
  message_id: { type: String, default: null },
  host: { type: String, required: true },
  players: [playerSchema],
  status: { type: String, default: 'lobby', enum: ['lobby', 'active', 'results', 'finished'] },
  current_round: { type: Number, default: 0 },
  total_rounds: { type: Number, default: 5 },
  round_time_sec: { type: Number, default: 30 },
  rounds: [roundSchema],
  created_at: { type: Date, default: Date.now },
}, { id: false });

minigameSessionSchema.index({ channel: 1, status: 1 });
minigameSessionSchema.index({ created_at: 1 }, { expireAfterSeconds: 86400 });

export default mongoose.model('MinigameSession', minigameSessionSchema);
