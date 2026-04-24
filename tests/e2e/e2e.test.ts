import supertest from 'supertest';
import mongoose from 'mongoose';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { DateTime } from 'luxon';
import { Job } from 'bullmq';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { createApp } from '../../src/app.js';
import { UserRepositoryMongo } from '../../src/infrastructure/mongo/user.repository.mongo.js';
import { ReminderRepositoryMongo } from '../../src/infrastructure/mongo/reminder.repository.js';
import { UserService } from '../../src/modules/user/service.js';
import { UserController } from '../../src/modules/user/controller.js';
import { ReminderQueue } from '../../src/modules/reminder/model.js';
import { ReminderJobProcessor } from '../../src/modules/notification/worker.js';
import { NotificationService } from '../../src/modules/notification/service.js';
import { LogFileChannel } from '../../src/modules/notification/channel/logfile.js';
import { startInfra, stopInfra, TestInfra } from '../integration/setup/containers.js';
import { startBirthdayScheduler } from '../../src/modules/reminder/scheduler.js';
import { config } from '../../src/config/index.js';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const waitForJob = (worker: Worker, jobId: string, timeoutMs = 10_000): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Worker timed out waiting for job ${jobId}`)),
      timeoutMs,
    );
    const onCompleted = (job: Job) => {
      if (job.id === jobId) {
        clearTimeout(timer);
        worker.off('completed', onCompleted);
        worker.off('failed', onFailed);
        resolve();
      }
    };
    const onFailed = (job: Job | undefined, err: Error) => {
      if (job?.id === jobId) {
        clearTimeout(timer);
        worker.off('completed', onCompleted);
        worker.off('failed', onFailed);
        reject(err);
      }
    };
    worker.on('completed', onCompleted);
    worker.on('failed', onFailed);
  });

const readLogFile = async (logDir: string): Promise<string> => {
  const filePath = path.join(logDir, 'notifications.log');
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
};

const countLogEntries = (log: string): number =>
  (log.match(/🎉 Happy Birthday!/g) ?? []).length;

/**
 * Runs one scheduler tick directly — bypasses cron timing and Redlock.
 * Mirrors exactly what startBirthdayScheduler does inside its cron callback.
 */
const runSchedulerTick = async (
  userRepo: UserRepositoryMongo,
  queue: ReminderQueue,
): Promise<void> => {
  const now        = DateTime.utc();
  const next8Hours = now.plus({ hours: 8 });

  const users = await userRepo.findUsersWithBirthdayBetween(
    now.toJSDate(),
    next8Hours.toJSDate(),
  );

  for (const user of users) {
    const scheduledAt = DateTime.fromJSDate(user.nextBirthDayAt).toUTC().toISO();
    if (!scheduledAt) continue;

    const delay = DateTime
      .fromJSDate(user.nextBirthDayAt)
      .toUTC()
      .diff(now, 'milliseconds')
      .milliseconds;

    if (delay <= 0) continue;

    await queue.add({ userId: user.id, type: 'birthday', scheduledAt }, delay);
  }
};

// ─────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────

const validPayload = {
  name:     'Gojo Satoru',
  email:    'gojo@jujutsu.com',
  birthday: '1989-12-07',
  timezone: 'Asia/Tokyo',
};

// ─────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────

describe('Birthday Reminder E2E', () => {
  let infra:          TestInfra;
  let app:            ReturnType<typeof createApp>;
  let reminderQueue:  ReminderQueue;
  let rawQueue:       Queue;
  let worker:         Worker;
  let userRepo:       UserRepositoryMongo;
  let reminderRepo:   ReminderRepositoryMongo;
  let logDir:         string;
  let logFileChannel: LogFileChannel;
  let queueEvents:    QueueEvents;

  beforeAll(async () => {
    infra = await startInfra();

    logDir         = await fs.mkdtemp(path.join(os.tmpdir(), 'felix-natalis-e2e-'));
    logFileChannel = new LogFileChannel(logDir);

    userRepo     = new UserRepositoryMongo();
    reminderRepo = new ReminderRepositoryMongo();

    reminderQueue = new ReminderQueue(infra.redisClient);
    rawQueue      = new Queue(config.queueName, { connection: infra.redisClient });

    const notificationSvc = new NotificationService([logFileChannel]);
    const processor       = new ReminderJobProcessor(
      userRepo,
      reminderRepo,
      notificationSvc,
    );

    worker = new Worker(
      config.queueName,
      (job) => processor.process(job),
      { connection: infra.redisClient, concurrency: 1 },
    );
    queueEvents = new QueueEvents(config.queueName, {
      connection: infra.redisClient,
    });

    const userService    = new UserService(userRepo, reminderQueue);
    const userController = new UserController(userService);
    app = createApp(userController);
  });

  afterAll(async () => {
    await worker.close();
    await queueEvents.close();
    await rawQueue.close();
    await fs.rm(logDir, { recursive: true, force: true });
    await stopInfra(infra);
    await mongoose.disconnect();
  });

  afterEach(async () => {
    await mongoose.connection.collection('users').deleteMany({});
    await mongoose.connection.collection('reminderlogs').deleteMany({});
    await rawQueue.obliterate({ force: true });
    await fs.writeFile(path.join(logDir, 'notifications.log'), '', 'utf-8');
  });

  // ─────────────────────────────────────────────
  // Validation
  // ─────────────────────────────────────────────

  describe('validation', () => {
    it('should reject missing required fields with 400', async () => {
      const res = await supertest(app)
        .post('/api/v1/users/register')
        .send({});

      expect(res.status).toBe(400);

      const log = await readLogFile(logDir);
      expect(countLogEntries(log)).toBe(0);
    });

    it('should reject invalid email format with 400', async () => {
      const res = await supertest(app)
        .post('/api/v1/users/register')
        .send({ ...validPayload, email: 'not-an-email' });

      expect(res.status).toBe(400);
    });

    it('should reject invalid timezone with 400', async () => {
      const res = await supertest(app)
        .post('/api/v1/users/register')
        .send({ ...validPayload, timezone: 'Not/ATimezone' });

      expect(res.status).toBe(400);
    });

    it('should reject invalid birthday format with 400', async () => {
      const res = await supertest(app)
        .post('/api/v1/users/register')
        .send({ ...validPayload, birthday: 'not-a-date' });

      expect(res.status).toBe(400);
    });
  });

  // ─────────────────────────────────────────────
  // Registration -> DB -> Queue
  // ─────────────────────────────────────────────

  describe('registration -> DB -> queue', () => {
    it('should register user and persist to DB', async () => {
      const res = await supertest(app)
        .post('/api/v1/users/register')
        .send(validPayload);

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();

      const persisted = await userRepo.findByEmail('gojo@jujutsu.com');
      expect(persisted).not.toBeNull();
      expect(persisted?.nextBirthDayAt).toBeInstanceOf(Date);
    });

    it('should enqueue job when scheduler tick runs for registered user within window', async () => {
      // Register via HTTP so the full registration flow is exercised
      const res = await supertest(app)
        .post('/api/v1/users/register')
        .send(validPayload);

      expect(res.status).toBe(201);
      const userId = res.body.id;

      // The registration sets nextBirthDayAt to the real next birthday (months away).
      // Force it into the scheduler's 8-hour window so the tick picks it up.
      await mongoose.connection.collection('users').updateOne(
        { _id: new mongoose.Types.ObjectId(userId) },
        { $set: { nextBirthDayAt: DateTime.utc().plus({ hours: 4 }).toJSDate() } },
      );
      const debugUser = await mongoose.connection.collection('users').findOne(
        { _id: new mongoose.Types.ObjectId(userId) }
      );
      const now = DateTime.utc();
      const next8Hours = now.plus({ hours: 8 });
      const usersInWindow = await userRepo.findUsersWithBirthdayBetween(
        now.toJSDate(),
        next8Hours.toJSDate(),
      );
      await runSchedulerTick(userRepo, reminderQueue); 

      const delayed = await rawQueue.getDelayed();
      expect(delayed).toHaveLength(1);
      expect(delayed[0].data.userId).toBe(userId);
    });

    it('should return 409 and not enqueue a second job on duplicate email', async () => {
      await supertest(app).post('/api/v1/users/register').send(validPayload);
      const res = await supertest(app).post('/api/v1/users/register').send(validPayload);

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/email/i);

      // Only one user persisted despite two attempts
      const users = await mongoose.connection.collection('users').find({}).toArray();
      expect(users).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────
  // Deactivation -> Queue Cleanup
  // ─────────────────────────────────────────────

  describe('deactivation -> queue cleanup', () => {
    it('should deactivate user, mark inactive in DB, and remove queued job', async () => {
      // Seed user inside window so scheduler enqueues a job
      const inWindow = DateTime.utc().plus({ hours: 4 }).toJSDate();
      const created  = await userRepo.create({
        name:           validPayload.name,
        email:          validPayload.email,
        birthday:       new Date('1989-12-07'),
        timezone:       validPayload.timezone,
        nextBirthDayAt: inWindow,
        active:         true,
      });

      await runSchedulerTick(userRepo, reminderQueue);

      const before = await rawQueue.getDelayed();
      expect(before).toHaveLength(1);

      const res = await supertest(app)
        .patch(`/api/v1/users/deactivate/${created.id}`);

      expect(res.status).toBe(204);

      const after = await rawQueue.getDelayed();
      expect(after).toHaveLength(0);

      const user = await userRepo.findById(created.id);
      expect(user?.active).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // Timezone Update -> Queue Re-enqueue
  // ─────────────────────────────────────────────

  describe('timezone update -> queue re-enqueue', () => {
    it('should remove old job and update nextBirthDayAt in DB when timezone changes', async () => {
      const created = await supertest(app)
        .post('/api/v1/users/register')
        .send(validPayload);

      const userId = created.body.id;

      // Move into window and enqueue via scheduler
      await mongoose.connection.collection('users').updateOne(
        { _id: new mongoose.Types.ObjectId(userId) },
        { $set: { nextBirthDayAt: DateTime.utc().plus({ hours: 4 }).toJSDate() } },
      );

      await runSchedulerTick(userRepo, reminderQueue);

      const before = await rawQueue.getDelayed();
      expect(before).toHaveLength(1);
      const oldScheduled = before[0].data.scheduledAt;

      const res = await supertest(app)
        .put(`/api/v1/users/${userId}`)
        .send({ timezone: 'America/New_York' });

      expect(res.status).toBe(200);

      // Old job removed — scheduler hasn't run again yet so queue is empty
      const after = await rawQueue.getDelayed();
      expect(after).toHaveLength(0);

      // DB reflects updated timezone and recomputed nextBirthDayAt
      const updatedUser = await userRepo.findById(userId);
      expect(updatedUser?.timezone).toBe('America/New_York');

      const newBirthday = DateTime
        .fromJSDate(updatedUser!.nextBirthDayAt)
        .setZone('America/New_York');
      expect(newBirthday.hour).toBe(config.birthdayHour);

      // Recomputed nextBirthDayAt differs from the old scheduledAt
      expect(updatedUser!.nextBirthDayAt.toISOString()).not.toBe(oldScheduled);
    });
  });

  // ─────────────────────────────────────────────
  // Scheduler Tick -> Queue
  // ─────────────────────────────────────────────

  describe('scheduler tick -> queue', () => {
    it('should enqueue jobs for users whose birthday falls within the next 8 hours', async () => {
      // Inside window: 4 hours from now
      await userRepo.create({
        name:           'In Window',
        email:          'in@window.com',
        birthday:       new Date('1990-01-01'),
        timezone:       'UTC',
        nextBirthDayAt: DateTime.utc().plus({ hours: 4 }).toJSDate(),
        active:         true,
      });

      // Outside window: 12 hours from now
      await userRepo.create({
        name:           'Out Of Window',
        email:          'out@window.com',
        birthday:       new Date('1990-06-15'),
        timezone:       'UTC',
        nextBirthDayAt: DateTime.utc().plus({ hours: 12 }).toJSDate(),
        active:         true,
      });

      await runSchedulerTick(userRepo, reminderQueue);

      const delayed = await rawQueue.getDelayed();
      expect(delayed).toHaveLength(1);
      expect(delayed[0].data.userId).toBeDefined();
    });

    it('should not enqueue inactive users', async () => {
      await userRepo.create({
        name:           'Inactive User',
        email:          'inactive@test.com',
        birthday:       new Date('1990-01-01'),
        timezone:       'UTC',
        nextBirthDayAt: DateTime.utc().plus({ hours: 2 }).toJSDate(),
        active:         false,
      });

      await runSchedulerTick(userRepo, reminderQueue);

      const delayed = await rawQueue.getDelayed();
      expect(delayed).toHaveLength(0);
    });

    it('should not enqueue users whose nextBirthDayAt has already passed', async () => {
      await userRepo.create({
        name:           'Past Birthday',
        email:          'past@test.com',
        birthday:       new Date('1990-01-01'),
        timezone:       'UTC',
        // delay <= 0 — already passed
        nextBirthDayAt: DateTime.utc().minus({ minutes: 1 }).toJSDate(),
        active:         true,
      });

      await runSchedulerTick(userRepo, reminderQueue);

      const delayed = await rawQueue.getDelayed();
      expect(delayed).toHaveLength(0);
    });

    it('should not enqueue duplicate jobs if scheduler tick runs twice', async () => {
      await userRepo.create({
        name:           'In Window',
        email:          'in@window.com',
        birthday:       new Date('1990-01-01'),
        timezone:       'UTC',
        nextBirthDayAt: DateTime.utc().plus({ hours: 4 }).toJSDate(),
        active:         true,
      });

      // Two consecutive ticks — queue.add should be idempotent or ReminderQueue
      // deduplicates by jobId; assert only one job exists after both ticks
      await runSchedulerTick(userRepo, reminderQueue);
      await runSchedulerTick(userRepo, reminderQueue);

      const delayed = await rawQueue.getDelayed();
      expect(delayed).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────
  // Worker -> LogFile -> DB Update
  // ─────────────────────────────────────────────

  describe('worker -> logfile notification -> DB update', () => {
    it('should process job, write to log file, and advance nextBirthDayAt', async () => {
      const registerRes = await supertest(app)
        .post('/api/v1/users/register')
        .send(validPayload);

      expect(registerRes.status).toBe(201);
      const userId = registerRes.body.id;

      // Move nextBirthDayAt inside the scheduler window and run a tick
      await mongoose.connection.collection('users').updateOne(
        { _id: new mongoose.Types.ObjectId(userId) },
        { $set: { nextBirthDayAt: DateTime.utc().plus({ hours: 4 }).toJSDate() } },
      );

      await runSchedulerTick(userRepo, reminderQueue);

      const userBefore           = await userRepo.findById(userId);
      const originalNextBirthday = userBefore!.nextBirthDayAt;

      const delayed    = await rawQueue.getDelayed();
      const jobId      = delayed[0].id!;
      const workerDone = waitForJob(worker, jobId);
      await delayed[0].changeDelay(0);
      await workerDone;

      // 1. Log file written with correct recipient
      const log = await readLogFile(logDir);
      expect(countLogEntries(log)).toBe(1);
      expect(log).toContain('Gojo Satoru');
      expect(log).toContain('gojo@jujutsu.com');

      // 2. nextBirthDayAt advanced by exactly one year
      const userAfter = await userRepo.findById(userId);
      const advanced  = DateTime.fromJSDate(userAfter!.nextBirthDayAt);
      const original  = DateTime.fromJSDate(originalNextBirthday);

      expect(advanced.year).toBe(original.year + 1);
      expect(advanced.month).toBe(original.month);
      expect(advanced.day).toBe(original.day);
      expect(advanced.hour).toBe(original.hour);

      // 3. Idempotency log created in DB
      const logs = await mongoose.connection
        .collection('reminderlogs')
        .find({})
        .toArray();
      expect(logs).toHaveLength(1);
      expect(logs[0].userId.toString()).toBe(userId);
    });

    it('should not write to log file if user was deleted before job processed', async () => {
      // Seed user inside window
      const created = await userRepo.create({
        name:           validPayload.name,
        email:          validPayload.email,
        birthday:       new Date('1989-12-07'),
        timezone:       validPayload.timezone,
        nextBirthDayAt: DateTime.utc().plus({ hours: 4 }).toJSDate(),
        active:         true,
      });

      await runSchedulerTick(userRepo, reminderQueue);
      const delayed = await rawQueue.getDelayed();

      // Delete user before job fires
      await supertest(app).delete(`/api/v1/users/${created.id}`);

      const processor = new ReminderJobProcessor(
        userRepo,
        reminderRepo,
        new NotificationService([logFileChannel]),
      );

      await processor.process({
        data:         delayed[0].data,
        attemptsMade: 0,
      } as any);

      const log = await readLogFile(logDir);
      expect(countLogEntries(log)).toBe(0);
    });

    it('should not write duplicate log entries on retry after idempotency claim', async () => {
      // Seed user inside window
      const created = await userRepo.create({
        name:           validPayload.name,
        email:          validPayload.email,
        birthday:       new Date('1989-12-07'),
        timezone:       validPayload.timezone,
        nextBirthDayAt: DateTime.utc().plus({ hours: 4 }).toJSDate(),
        active:         true,
      });

      await runSchedulerTick(userRepo, reminderQueue);
      const delayed    = await rawQueue.getDelayed();
      const jobId      = delayed[0].id!;
      const workerDone = waitForJob(worker, jobId);
      await delayed[0].changeDelay(0);
      await workerDone;

      // Simulate retry with same job data
      const processor = new ReminderJobProcessor(
        userRepo,
        reminderRepo,
        new NotificationService([logFileChannel]),
      );

      await processor.process({
        data:         delayed[0].data,
        attemptsMade: 1,
      } as any);

      const log = await readLogFile(logDir);
      expect(countLogEntries(log)).toBe(1);
    });

    it('should write separate log entries for different users', async () => {
      // Seed both users inside window
      await userRepo.create({
        name:           'Gojo Satoru',
        email:          'gojo@jujutsu.com',
        birthday:       new Date('1989-12-07'),
        timezone:       'Asia/Tokyo',
        nextBirthDayAt: DateTime.utc().plus({ hours: 3 }).toJSDate(),
        active:         true,
      });
      await userRepo.create({
        name:           'Nanami Kento',
        email:          'nanami@jujutsu.com',
        birthday:       new Date('1988-07-03'),
        timezone:       'Asia/Tokyo',
        nextBirthDayAt: DateTime.utc().plus({ hours: 5 }).toJSDate(),
        active:         true,
      });

      await runSchedulerTick(userRepo, reminderQueue);

      const delayed = await rawQueue.getDelayed();
      expect(delayed).toHaveLength(2);

      for (const job of delayed) {
        const done = waitForJob(worker, job.id!);
        await job.changeDelay(0);
        await done;
      }

      const log = await readLogFile(logDir);
      expect(countLogEntries(log)).toBe(2);
      expect(log).toContain('Gojo Satoru');
      expect(log).toContain('Nanami Kento');
    });
  });
});