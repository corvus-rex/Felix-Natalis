import cron from 'node-cron';
import { DateTime } from 'luxon';
import type Redlock from 'redlock';
import { IUserRepository } from '../user/repository.js';
import { IReminderQueue, ReminderJobData } from './model.js';
import { logger } from '../../infrastructure/logger.js';
import { config } from '../../config/index.js';

const LOOKAHEAD_HOURS = 8;

export const toCronExpression = (frequencyHours: number): string => {
  switch (frequencyHours) {
    case 1:  return '0 * * * *';
    case 2:  return '0 */2 * * *';
    case 3:  return '0 */3 * * *';
    case 6:  return '0 */6 * * *';
    default:
      logger.warn(`unsupported schedulingFrequency ${frequencyHours}h, falling back to hourly`);
      return '0 * * * *';
  }
};

const toLockTtlMs = 120_000; 

export const runSchedulerTick = async (
  redlock:  Redlock,
  userRepo: IUserRepository,
  queue:    IReminderQueue,
  lockTtlMs: number,
): Promise<void> => {
  let lock;
  try {
    lock = await redlock.acquire(['locks:cron:birthday'], lockTtlMs);
    const now       = DateTime.utc();
    const windowEnd = now.plus({ hours: LOOKAHEAD_HOURS });

    logger.info('birthday scheduler started', {
      from: now.toISO(),
      to:   windowEnd.toISO(),
    });

    let cursor:       string | undefined = undefined;
    let totalEnqueued = 0;

    do {
      const users = await userRepo.findUsersWithBirthdayBetween(
        now.toJSDate(),
        windowEnd.toJSDate(),
        cursor,
      );

      if (users.length === 0) break;

      const jobs = users.flatMap(user => {
        const scheduledAt = DateTime.fromJSDate(user.nextBirthDayAt).toUTC().toISO();
        if (!scheduledAt) {
          logger.warn('invalid nextBirthDayAt, skipping user', { userId: user.id });
          return [];
        }
        const delay = DateTime
          .fromJSDate(user.nextBirthDayAt)
          .toUTC()
          .diff(now, 'milliseconds')
          .milliseconds;

        if (delay <= 0) return [];

        const jobData: ReminderJobData = {
          userId: user.id,
          type:   'birthday',
          scheduledAt,
        };
        return [{ data: jobData, delay }];
      });

      if (jobs.length > 0) {
        await queue.addBulk(jobs);
        totalEnqueued += jobs.length;
      }

      cursor = users.length === config.queryBatchSize
        ? users[users.length - 1].id
        : undefined;

    } while (cursor !== undefined);

    logger.info('birthday scheduler complete', { totalEnqueued });

  } catch (err) {
    logger.warn('scheduler failed or lock not acquired', { err });
  } finally {
    if (lock) {
      try {
        await lock.unlock();
      } catch (err) {
        logger.error('failed to release lock', { err });
      }
    }
  }
};

export const startBirthdayScheduler = (
  redlock:  Redlock,
  userRepo: IUserRepository,
  queue:    IReminderQueue,
): void => {
  const cronExpression = toCronExpression(config.schedulingFrequency);
  const lockTtlMs      = toLockTtlMs;

  logger.info('birthday scheduler initialized', {
    frequencyHours: config.schedulingFrequency,
    cronExpression,
    lockTtlMs,
  });

  cron.schedule(cronExpression, () =>
    runSchedulerTick(redlock, userRepo, queue, lockTtlMs)
  );
};