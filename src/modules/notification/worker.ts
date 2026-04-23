import { Worker, QueueEvents } from 'bullmq';
import type { Redis } from 'ioredis';

import { IUserRepository } from '../user/repository.js';
import { INotificationService } from '../notification/service.js';
import { ReminderJobData } from '../reminder/model.js';

import { resolveLocaleFromTimezone } from '../notification/builder/birthday/locale/index.js';
import { logger } from '../../infrastructure/logger.js';
import { config } from '../../config/index.js';

export const startWorker = (
  redis: Redis,
  userRepo: IUserRepository, 
  notificationService: INotificationService,
): void => {
  const worker = new Worker<ReminderJobData>(config.queueName, async (job) => {
      const { reminderId, userId, type } = job.data;

      // 1. fetch fresh data
      const user = await userRepo.findById(userId);

      if (!user) {
        logger.warn('job skipped: missing user or reminder', {userId, reminderId});
        return;
      }

      // 2. only handle birthday (future-proofing)
      if (type !== 'birthday') {
        logger.warn('unsupported reminder type', { type });
        return;
      }

      // 3. resolve locale
      const locale = resolveLocaleFromTimezone(user.timezone);

      // 4. send notification
      await notificationService.notifyBirthday({
          name: user.name,
          email: user.email,
        }, 
        locale);

      logger.info('birthday reminder sent', {userId, reminderId});
    },
    { connection: redis }
  );

  // queue-level failures (job execution errors)
  const events = new QueueEvents('reminder', { connection: redis });

  events.on('failed', ({ jobId, failedReason }) => {
    logger.error('reminder failed', { jobId, failedReason });
  });

  // worker-level errors (infra issues)
  worker.on('error', (err) => {
    logger.error('worker error', { err });
  });
};