import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../../config/index.js';

export interface ReminderJobData {
  userId: string;
  type: 'birthday';
  scheduledAt: string; // MUST be ISO string (normalized)
}

export interface IReminderQueue {
  add(data: ReminderJobData, delay: number): Promise<void>;
  removeById(jobId: string): Promise<void>;
  removeBirthdayReminder(userId: string, scheduledAt: string): Promise<void>;
}

export class ReminderQueue implements IReminderQueue {
  private queue: Queue<ReminderJobData>;

  constructor(redis: Redis) {
    this.queue = new Queue(config.queueName, { connection: redis });
  }


  private buildJobId(data: ReminderJobData): string {
    const normalized = new Date(data.scheduledAt).toISOString();
    // Replace : in ISO string (e.g. 2025-12-07T00_00_00.000Z)
    const safeTimestamp = normalized.replace(/:/g, '_');
    return `${data.type}_${data.userId}_${safeTimestamp}`;
  }

  async add(data: ReminderJobData, delay: number): Promise<void> {
    const scheduledAt = new Date(data.scheduledAt).toISOString();

    const normalizedData: ReminderJobData = {
      ...data,
      scheduledAt,
    };

    const jobId = this.buildJobId(normalizedData);

    await this.queue.add('send-reminder', normalizedData, {
      delay,
      jobId,

      // keep job for a while to preserve dedup
      removeOnComplete: {
        age: 3600, // 1 hour
      },
    });
  }

  async removeById(jobId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (job) {
      await job.remove();
    }
  }

  async removeBirthdayReminder(userId: string, scheduledAt: string): Promise<void> {
    const jobId = this.buildJobId({
      userId,
      type: 'birthday',
      scheduledAt,
    });
    await this.removeById(jobId);
  }
}