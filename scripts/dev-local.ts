import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// A local MongoDB process with durable storage, independent of the temporary test DB.
const dbPath = path.resolve('.data/mongo');
await mkdir(dbPath, { recursive: true });
const mongo = await MongoMemoryServer.create({
    instance: { dbPath, dbName: 'kronum', storageEngine: 'wiredTiger', ip: '127.0.0.1' },
});
process.env.MONGO_URI = mongo.getUri('kronum');
const { default: app } = await import('../src/app.js');
await mongoose.connect(process.env.MONGO_URI);
await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
const port = process.env.PORT || 6200;
const server = app.listen(port, '127.0.0.1', () => {
    console.log(`Kronum API: http://127.0.0.1:${port}`);
    console.log(`Datos locales persistentes: ${dbPath}`);
});
let stopping = false;
async function stop() {
    if (stopping) return;
    stopping = true;
    server.close();
    await mongoose.disconnect();
    await mongo.stop({ doCleanup: false, force: false });
    process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
