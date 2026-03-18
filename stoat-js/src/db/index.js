import mongoose from 'mongoose';
import config from '../../config.js';
import logger from '../logger.js';

export async function connectDb() {
  await mongoose.connect(config.mongodb);
  logger.info({ msg: 'MongoDB connected' });
}
