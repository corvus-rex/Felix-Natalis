import rateLimit from 'express-rate-limit';
import { RedisStore, RedisReply } from 'rate-limit-redis';
import type { Redis } from 'ioredis';

export const createRateLimiters = (redis: Redis) => {
  const makeStore = (prefix: string) =>
    new RedisStore({
      prefix,
      sendCommand: (...args: string[]) =>
        redis.call(...args as [string, ...string[]]) as Promise<RedisReply>,
    });

  const apiRateLimiter = rateLimit({
    windowMs:        15 * 60 * 1000,
    max:             100,
    standardHeaders: true,
    legacyHeaders:   false,
    store:           makeStore('rl:api:'),
    message:         { error: 'Too many requests, please try again later.' },
  });

  const registerRateLimiter = rateLimit({
    windowMs:        60 * 60 * 1000,
    max:             10,
    standardHeaders: true,
    legacyHeaders:   false,
    store:           makeStore('rl:register:'),
    message:         { error: 'Too many registration attempts, please try again later.' },
  });

  return { apiRateLimiter, registerRateLimiter };
};