import cron from 'node-cron';
import { DateTime } from 'luxon';
import type Redlock from 'redlock';

import { IUserRepository } from '../user/repository.js';
import { IReminderQueue } from './model.js';
import { getNextBirthday } from './birthdayUtils.js';
import { logger } from '../../infrastructure/logger.js';

export const startBirthdayScheduler = (
  redlock: Redlock,
  userRepo: IUserRepository,
  queue: IReminderQueue,
): void => {

    // run every day at midnight UTC
    cron.schedule('0 * * * *', async () => {
        let lock;
        try {
            lock = await redlock.acquire(['locks:cron:birthday'], 600_000);

            const users = await userRepo.findActive();

            for (const user of users) {
                const scheduledAt = getNextBirthday(user.birthday, user.timezone);

                const delay = DateTime
                .fromISO(scheduledAt, { zone: 'utc' })
                .diff(DateTime.utc(), 'milliseconds')
                .milliseconds;

                if (delay <= 0) continue;

                await queue.add({userId: user.id, type: 'birthday', scheduledAt}, delay);
            }

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
    });
};