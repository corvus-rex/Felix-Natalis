import 'dotenv/config';
import express from 'express';
import { config } from './config/index.js';
import { logger } from './infrastructure/logger.js';
import { IDatabaseClient, MongooseClient, connectDatabase } from './infrastructure/db.js';

let dbClient: IDatabaseClient;
let uri: string;
switch (config.dbType) {
  case 'mongodb':
    logger.info('Using MongoDB as the database');
    dbClient = new MongooseClient({
        maxPoolSize: config.dbPoolSize,
        serverSelectionTimeoutMS: config.serverTimeout,
    });
    uri = config.mongoUri;
    break;
  default:
    logger.error(`Unsupported DB_TYPE: ${config.dbType}`);
    process.exit(1);
}

await connectDatabase(dbClient, uri, logger);

const app = express();

app.get('/health', (_, res) => {
  res.json({ status: 'Hello sekai' });
});

app.listen(config.port, () => {
  logger.info(`Server running on port ${config.port}`);
});