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
  addBulk(jobs: Array<{ data: ReminderJobData; delay: number }>): Promise<void>;
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

  private normalizeJobData(data: ReminderJobData): ReminderJobData {
    return { ...data, scheduledAt: new Date(data.scheduledAt).toISOString() };
  }

  async add(data: ReminderJobData, delay: number): Promise<void> {
    const normalizedData = this.normalizeJobData(data);
    await this.queue.add('send-reminder', normalizedData, {
      delay,
      jobId: this.buildJobId(normalizedData),
      removeOnComplete: { age: 3600 },
    });
  }

  async addBulk(jobs: Array<{ data: ReminderJobData; delay: number }>): Promise<void> {
    if (jobs.length === 0) return;

    const bulkJobs = jobs.map(({ data, delay }) => {
      const normalizedData = this.normalizeJobData(data);
      return {
        name: 'send-reminder',
        data: normalizedData,
        opts: {
          delay,
          jobId: this.buildJobId(normalizedData),
          removeOnComplete: { age: 3600 },
        },
      };
    });

    await this.queue.addBulk(bulkJobs);
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