import { Worker, QueueEvents } from 'bullmq';
import type { Redis } from 'ioredis';

import { IUserRepository } from '../user/repository.js';
import { IReminderRepository } from '../reminder/repository.js';
import { INotificationService } from '../notification/service.js';
import { ReminderJobData } from '../reminder/model.js';

import { resolveLocaleFromTimezone } from '../notification/builder/birthday/locale/index.js';
import { logger } from '../../infrastructure/logger.js';
import { config } from '../../config/index.js';
import { DateTime } from 'luxon';

export const startWorker = (
  redis: Redis,
  userRepo: IUserRepository,
  reminderRepo: IReminderRepository,
  notificationService: INotificationService,
): void => {

  const worker = new Worker<ReminderJobData>(
    config.queueName,
    async (job) => {
      const { userId, type, scheduledAt } = job.data;
      const normalizedScheduledAt = new Date(scheduledAt).toISOString();

      // 1. fetch fresh data
      const user = await userRepo.findById(userId);
      if (!user) {
        logger.warn('job skipped: missing user', { userId, scheduledAt: normalizedScheduledAt });
        return;
      }

      // 2. idempotency claim (ensure only one worker processes reminders for the same user+time)
      const claimed = await reminderRepo.claimReminder(userId, new Date(normalizedScheduledAt));

      if (!claimed) {
        logger.info('reminder already processed — skipping', {userId, scheduledAt: normalizedScheduledAt});
        return;
      }

      // 3. only handle supported type (we could extend with more types in the future)
      if (type !== 'birthday') {
        logger.warn('unsupported reminder type', { type, userId });
        return;
      }

      try {
        // 4. resolve locale
        const locale = resolveLocaleFromTimezone(user.timezone);

        // 5. send notification
        await notificationService.notifyBirthday(
          { name: user.name, email: user.email },
          locale
        );
        
        // 6. advance nextBirthDayAt to next year — must happen after successful send
        const nextBirthday = DateTime
          .fromJSDate(user.nextBirthDayAt)
          .plus({ years: 1 })
          .toJSDate();

        await userRepo.update(userId, { nextBirthDayAt: nextBirthday });

        logger.info('birthday reminder sent', {
          userId,
          scheduledAt:    normalizedScheduledAt,
          nextBirthDayAt: nextBirthday.toISOString(),
        });

      } catch (err: any) {
        logger.error('failed to send birthday reminder', {
          userId,
          scheduledAt: normalizedScheduledAt,
          err,
        });

        throw err;
      }
    },
    {
      connection: redis,
      concurrency: 5,
    }
  );

  // queue-level failures
  const events = new QueueEvents(config.queueName, { connection: redis });

  events.on('failed', ({ jobId, failedReason }) => {
    logger.error('reminder failed', { jobId, failedReason });
  });

  // worker-level errors
  worker.on('error', (err) => {
    logger.error('worker error', { err });
  });
};