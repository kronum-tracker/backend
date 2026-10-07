import mongoose from 'mongoose';
import { getLogger } from '../utils/logger.js';
import { bootEnv } from '../config/bootConfig.js';

const logger = getLogger().setTag('mongo.ts');

const MONGO_URI = bootEnv.MONGO_URI;

export const connectMongo = async () => {
    logger.info('Connecting to MongoDB');
    await mongoose.connect(MONGO_URI);
    await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
    logger.info('Connected to MongoDB');
};

export const disconnectMongo = async () => {
    logger.info('Disconnecting from MongoDB');
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB');
};
