import { Queue } from 'bullmq';
import { ReminderQueue } from '../../../src/modules/reminder/model';
import { startInfra, stopInfra, TestInfra } from '../setup/containers';
import { config } from '../../../src/config/index.js';

describe('ReminderQueue (integration)', () => {
  let infra:  TestInfra;
  let queue:  ReminderQueue;
  let rawQueue: Queue;

  beforeAll(async () => {
    infra    = await startInfra();
    queue    = new ReminderQueue(infra.redisClient);
    rawQueue = new Queue(config.queueName, { connection: infra.redisClient });
  });

  afterAll(async () => {
    await rawQueue.close();
    await stopInfra(infra);
  });

  afterEach(async () => {
    await rawQueue.drain();
    await rawQueue.obliterate({ force: true });
  });

  const jobData = {
    userId:      'userid-123',
    type:        'birthday' as const,
    scheduledAt: '2026-12-07T00:00:00.000Z',
  };

  it('should enqueue a job with the correct data', async () => {
    await queue.add(jobData, 60_000);

    const delayed = await rawQueue.getDelayed();
    expect(delayed).toHaveLength(1);
    expect(delayed[0].data).toMatchObject(jobData);
  });

  it('should enqueue job with a delay', async () => {
    const delay = 60_000;
    await queue.add(jobData, delay);

    const delayed = await rawQueue.getDelayed();
    expect(delayed).toHaveLength(1);
  });

  it('should deduplicate jobs with the same jobId', async () => {
    await queue.add(jobData, 60_000);
    await queue.add(jobData, 60_000); // same jobId — should be ignored

    const delayed = await rawQueue.getDelayed();
    expect(delayed).toHaveLength(1);
  });

  it('should allow jobs for different users at the same scheduledAt', async () => {
    await queue.add(jobData, 60_000);
    await queue.add({ ...jobData, userId: 'userid-456' }, 60_000);

    const delayed = await rawQueue.getDelayed();
    expect(delayed).toHaveLength(2);
  });

  it('should normalize scheduledAt in jobId — same timestamp different format', async () => {
    await queue.add(jobData, 60_000);
    await queue.add({ ...jobData, scheduledAt: '2026-12-07T00:00:00Z' }, 60_000);

    const delayed = await rawQueue.getDelayed();
    expect(delayed).toHaveLength(1); // same normalized jobId
  });
});