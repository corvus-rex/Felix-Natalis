import { Queue, JobsOptions } from 'bullmq';
import { Redis } from 'ioredis'; 

export interface ReminderJobData {
  reminderId: string;
  userId: string;
  type: 'birthday';
  scheduledFor: number;
}

export interface IReminderQueue {
  add(data: ReminderJobData, delay: number, jobId: string): Promise<void>;
  removeJobs(pattern: string): Promise<void>;
  removeBirthdayReminders(userId: string): Promise<void>;
}

export class ReminderQueue implements IReminderQueue {
  private queue: Queue<ReminderJobData>;

  constructor(redis: Redis) {
    this.queue = new Queue('send-reminder', { connection: redis });
  }

  async add(data: ReminderJobData, delay: number, jobId: string): Promise<void> {
    await this.queue.add('send-reminder', data, {
      delay,
      jobId,
      removeOnComplete: true,
    });
  }

  async removeJobs(pattern: string): Promise<void> {
    const jobs = await this.queue.getJobs();
    await Promise.all(
      jobs
        .filter(job => job.id?.startsWith(pattern.replace('*', '')))
        .map(job => job.remove())
    );
  }
  async removeBirthdayReminders(userId: string): Promise<void> {
    await this.removeJobs(`birthday:${userId}:*`);
  }
}