import { Redis } from 'ioredis';
import { logger } from './logger.js';

export const connectRedis = (url: string): Redis => {
  const client = new Redis(url, { maxRetriesPerRequest: null });

  client.on('connect', () => logger.info('Redis connected'));
  client.on('error', (err: Error) => logger.error('Redis error', { err }));

  return client;
};