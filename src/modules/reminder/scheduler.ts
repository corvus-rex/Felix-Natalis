import cron from 'node-cron';
import { DateTime } from 'luxon';
import type Redlock from 'redlock';

import { IUserRepository } from '../user/repository.js';
import { IReminderQueue } from './model.js';
import { logger } from '../../infrastructure/logger.js';

export const startBirthdayScheduler = (
  redlock: Redlock,
  userRepo: IUserRepository,
  queue: IReminderQueue,
): void => {
  // run every hour
  cron.schedule('0 * * * *', async () => {
    let lock;

    try {
      lock = await redlock.acquire(['locks:cron:birthday'], 600_000);

      const now = DateTime.utc();
      const next12Hours = now.plus({ hours: 12 });

      // only fetch users whose next birthday is within next 12 hours
      const users = await userRepo.findUsersWithBirthdayBetween(
        now.toJSDate(),
        next12Hours.toJSDate()
      );

      logger.info('birthday scheduler started', {
        count: users.length,
        from: now.toISO(),
        to: next12Hours.toISO(),
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