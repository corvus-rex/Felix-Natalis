import 'dotenv/config';
import express from 'express';
import { config } from './config/index.js';
import { logger } from './infrastructure/logger.ts';

const app = express();

app.get('/health', (_, res) => {
  res.json({ status: 'Hello sekai' });
});

app.listen(config.port, () => {
  logger.info(`Server running on port ${config.port}`);
});