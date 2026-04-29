import express, { Application } from 'express';
import type { Redis } from 'ioredis';
import { UserController }       from './modules/user/controller.js';
import { userRouter }           from './modules/user/router.js';
import { errorHandler }         from './middleware/errorHandler.js';
import { morganMiddleware }     from './middleware/morganMiddleware.js';
import { createRateLimiters }   from './infrastructure/rateLimit.js';

export const createApp = (
  userController: UserController,
  redis: Redis,
): Application => {
  const app = express();

  app.set('trust proxy', 1);

  app.use(express.json());
  app.use(morganMiddleware);

  const { apiRateLimiter, registerRateLimiter } = createRateLimiters(redis);

  // Global limit on all API routes
  app.use('/api', apiRateLimiter);

  app.get('/health', (_, res) => {
    res.json({ status: 'Hello sekai' });
  });

  app.use('/api/v1/users', userRouter(userController, registerRateLimiter));
  app.use(errorHandler);

  return app;
};