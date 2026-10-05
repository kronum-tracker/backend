import mongoose from 'mongoose';
import { getLogger } from '../utils/logger.js';
import { bootEnv } from '../config/bootConfig.js';

const logger = getLogger().setTag('mongo.ts');

const MONGO_URI = bootEnv.MONGO_URI;

export const connectMongo = async () => {
    logger.info(`Connecting to MongoDB at ${MONGO_URI}`);
    await mongoose.connect(MONGO_URI);
    logger.info(`Connected to MongoDB at ${MONGO_URI}`);
};

export const disconnectMongo = async () => {
    logger.info(`Disconnecting from MongoDB at ${MONGO_URI}`);
    await mongoose.disconnect();
    logger.info(`Disconnected from MongoDB at ${MONGO_URI}`);
};
