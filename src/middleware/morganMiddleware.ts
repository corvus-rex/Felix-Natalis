import morgan from 'morgan';
import { httpLogger } from '../infrastructure/logger.js';

morgan.token('body', (req: any) => {
  if (!req.body) return '';
  
  const safeBody = { ...req.body };

  delete safeBody.email;
  delete safeBody.password;
  delete safeBody.token;

  return JSON.stringify(safeBody);
});

export const morganMiddleware = morgan(
  ':method :url :status - :response-time ms| body: :body',
  {
    stream: {
      write: (message: string) => httpLogger.http(message.trim()),
    },
  },
);