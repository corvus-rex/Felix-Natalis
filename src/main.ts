import 'dotenv/config';
import express from 'express';
import { config } from './config/index.js';

const app = express();

app.get('/health', (_, res) => {
  res.json({ status: 'Hello sekai' });
});

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});