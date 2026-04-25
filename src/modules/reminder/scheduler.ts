import cron from 'node-cron';
import { DateTime } from 'luxon';
import type Redlock from 'redlock';

import { IUserRepository } from '../user/repository.js';
import { IReminderQueue } from './model.js';
import { logger } from '../../infrastructure/logger.js';
import { config } from '../../config/index.js';

export const toCronExpression = (frequencyHours: number): string => {
  switch (frequencyHours) {
    case 1:  return '0 * * * *';       // every hour
    case 2:  return '0 */2 * * *';     // every 2 hours
    case 3:  return '0 */3 * * *';     // every 3 hours
    case 6:  return '0 */6 * * *';     // every 6 hours
    default:
      logger.warn(`unsupported schedulingFrequency ${frequencyHours}h, falling back to hourly`);
      return '0 * * * *';
  }
};


export const startBirthdayScheduler = (
  redlock: Redlock,
  userRepo: IUserRepository,
  queue: IReminderQueue,
): void => {
    
  const cronExpression = toCronExpression(config.schedulingFrequency);
  cron.schedule(cronExpression, async () => {
    let lock;

    try {
      lock = await redlock.acquire(['locks:cron:birthday'], 60_000);

      const now = DateTime.utc();
      const next8Hours = now.plus({ hours: 8 });

      // only fetch users whose next birthday is within next 8 hours
      const users = await userRepo.findUsersWithBirthdayBetween(
        now.toJSDate(),
        next8Hours.toJSDate()
      );

      logger.info('birthday scheduler started', {
        count: users.length,
        from: now.toISO(),
        to: next8Hours.toISO(),
      });

      for (const user of users) {
        const scheduledAt = DateTime
          .fromJSDate(user.nextBirthDayAt)
          .toUTC()
          .toISO();

        if (!scheduledAt) {
          logger.warn('invalid nextBirthDayAt, skipping user', {
            userId: user.id,
          });
          continue;
        }

        const delay = DateTime
          .fromJSDate(user.nextBirthDayAt)
          .toUTC()
          .diff(now, 'milliseconds')
          .milliseconds;

        if (delay <= 0) {
          continue;
        }

        await queue.add({userId: user.id, type: 'birthday', scheduledAt}, delay);
      }

      logger.info('birthday scheduler complete', {
        count: users.length,
      });

    } catch (err) {
      logger.warn('scheduler failed or lock not acquired', {err,});

    } finally {
      if (lock) {
        try {
          await lock.unlock();
        } catch (err) {
          logger.error('failed to release lock', {err});
        }
      }
    }
  });
};