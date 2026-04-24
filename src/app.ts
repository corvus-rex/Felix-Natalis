// src/app.ts
import express, { Application } from 'express';
import { UserController }    from './modules/user/controller.js';
import { userRouter }        from './modules/user/router.js';
import { errorHandler }      from './middleware/errorHandler.js';
import { morganMiddleware }  from './middleware/morganMiddleware.js';

export const createApp = (userController: UserController): Application => {
  const app = express();

  app.use(express.json());
  app.use(morganMiddleware);

  app.get('/health', (_, res) => {
    res.json({ status: 'Hello sekai' });
  });

  app.use('/api/v1/users', userRouter(userController));
  app.use(errorHandler);

  return app;
};