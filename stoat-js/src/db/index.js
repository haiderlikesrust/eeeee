import mongoose from 'mongoose';
import config from '../../config.js';

export async function connectDb() {
  await mongoose.connect(config.mongodb);
  console.log('MongoDB connected');
}
