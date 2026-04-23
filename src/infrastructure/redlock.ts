import Redlock, { CompatibleRedisClient } from 'redlock';
import { Redis } from 'ioredis';

export const createRedlock = (redis: Redis): Redlock =>
  new Redlock([redis as unknown as CompatibleRedisClient], { retryCount: 0 });