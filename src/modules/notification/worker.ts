import { Worker, QueueEvents, Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { IUserRepository }       from '../user/repository.js';
import { IReminderRepository }   from '../reminder/repository.js';
import { INotificationService }  from '../notification/service.js';
import { ReminderJobData }       from '../reminder/model.js';
import { resolveLocaleFromTimezone } from '../notification/builder/birthday/locale/index.js';
import { logger }                from '../../infrastructure/logger.js';
import { config }                from '../../config/index.js';
import { DateTime }              from 'luxon';
import { computeNextBirthdayAt } from '../reminder/birthdayUtils.js';

export class ReminderJobProcessor {
  constructor(
    private readonly userRepo:            IUserRepository,
    private readonly reminderRepo:        IReminderRepository,
    private readonly notificationService: INotificationService,
  ) {}

  async process(job: Job<ReminderJobData>): Promise<void> {
    const { userId, type, scheduledAt } = job.data;
    const normalizedScheduledAt = new Date(scheduledAt).toISOString();

    // 1. fetch fresh data
    const user = await this.userRepo.findById(userId);
    if (!user) {
      logger.warn('job skipped: missing user', { userId, scheduledAt: normalizedScheduledAt });
      return;
    }

    // 2. idempotency claim
    const claimed = await this.reminderRepo.claimReminder(
      userId,
      new Date(normalizedScheduledAt)
    );
    if (!claimed) {
      logger.info('reminder already processed — skipping', { userId, scheduledAt: normalizedScheduledAt });
      return;
    }

    // 3. type guard
    if (type !== 'birthday') {
      logger.warn('unsupported reminder type', { type, userId });
      return;
    }

    try {
      // 4. resolve locale
      const locale = resolveLocaleFromTimezone(user.timezone);

      // 5. send notification
      await this.notificationService.notifyBirthday(
        { name: user.name, email: user.email },
        locale
      );

      // 6. advance nextBirthDayAt
      const nextBirthday = computeNextBirthdayAt(user.birthday, user.timezone);

      await this.userRepo.update(userId, { nextBirthDayAt: nextBirthday });
      logger.info('birthday reminder sent', {
        userId,
        scheduledAt:    normalizedScheduledAt,
        nextBirthDayAt: nextBirthday.toISOString(),
      });
    } catch (err: any) {
      logger.error('failed to send birthday reminder', { userId, scheduledAt: normalizedScheduledAt, err });
      throw err;
    }
  }
}

// ── startWorker wires BullMQ to the processor ─────────────────
export const startWorker = (
  redis:               Redis,
  userRepo:            IUserRepository,
  reminderRepo:        IReminderRepository,
  notificationService: INotificationService,
): void => {
  const processor = new ReminderJobProcessor(userRepo, reminderRepo, notificationService);

  const worker = new Worker<ReminderJobData>(
    config.queueName,
    (job) => processor.process(job), 
    { connection: redis, concurrency: 5 }
  );

  const events = new QueueEvents(config.queueName, { connection: redis });
  events.on('failed', ({ jobId, failedReason }) => {
    logger.error('reminder failed', { jobId, failedReason });
  });

  worker.on('error', (err) => {
    logger.error('worker error', { err });
  });
};