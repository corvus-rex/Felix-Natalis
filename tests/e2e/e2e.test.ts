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
import { ReminderRepositoryMongo } from '../../src/infrastructure/mongo/reminder.repository.mongo.js';
import { UserService } from '../../src/modules/user/service.js';
import { UserController } from '../../src/modules/user/controller.js';
import { ReminderQueue } from '../../src/modules/reminder/model.js';
import { ReminderJobProcessor } from '../../src/modules/notification/worker.js';
import { NotificationService } from '../../src/modules/notification/service.js';
import { LogFileChannel } from '../../src/modules/notification/channel/logfile.js';
import { startInfra, stopInfra, TestInfra } from '../integration/setup/containers.js';
import { runSchedulerTick } from '../../src/modules/reminder/scheduler.js';
import { config } from '../../src/config/index.js';
import { computeNextBirthdayAt } from '../../src/modules/reminder/birthdayUtils.js';
import { createRedlock } from '../../src/infrastructure/redlock.js';
import { logger } from '../../src/infrastructure/logger.js';

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

// ─────────────────────────────────────────────
// Time anchor
// ─────────────────────────────────────────────

const BIRTHDAY_FIRE_UTC = DateTime.fromObject(
  { year: 2026, month: 12, day: 7, hour: config.birthdayHour, minute: 0, second: 0 },
  { zone: 'Asia/Tokyo' }
).toUTC();

const FIXED_NOW = BIRTHDAY_FIRE_UTC.minus({ hours: 4 });

// Always relative to FIXED_NOW, never to real time
const inWindow    = (hours: number) => FIXED_NOW.plus({ hours }).toJSDate();
const outOfWindow = (hours: number) => FIXED_NOW.plus({ hours: 8 + hours }).toJSDate();
const inPast      = (minutes: number) => FIXED_NOW.minus({ minutes }).toJSDate();

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
  let redlock:        ReturnType<typeof createRedlock>;
  const lockTtlMs =   120_000;

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

    redlock = createRedlock(infra.redisClient);

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
    await infra.redisClient.del('locks:cron:birthday');
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
      const res = await supertest(app)
        .post('/api/v1/users/register')
        .send(validPayload);

      expect(res.status).toBe(201);
      const userId = res.body.id;

      await runSchedulerTick(redlock, userRepo, reminderQueue, lockTtlMs, FIXED_NOW);

      const delayed = await rawQueue.getDelayed();
      console.log('Delayed jobs after registration and scheduler tick:', delayed);
      expect(delayed).toHaveLength(1);
      expect(delayed[0].data.userId).toBe(userId);
    });

    it('should return 409 and not enqueue a second job on duplicate email', async () => {
      await supertest(app).post('/api/v1/users/register').send(validPayload);
      const res = await supertest(app).post('/api/v1/users/register').send(validPayload);

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/email/i);

      const users = await mongoose.connection.collection('users').find({}).toArray();
      expect(users).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────
  // Deactivation -> Queue Cleanup
  // ─────────────────────────────────────────────

  describe('deactivation -> queue cleanup', () => {
    it('should deactivate user, mark inactive in DB, and remove queued job', async () => {
      const created = await userRepo.create({
        name:           validPayload.name,
        email:          validPayload.email,
        birthday:       new Date('1989-12-07'),
        timezone:       validPayload.timezone,
        nextBirthDayAt: inWindow(4),
        active:         true,
      });

      await runSchedulerTick(redlock, userRepo, reminderQueue, lockTtlMs, FIXED_NOW);

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

      await runSchedulerTick(redlock, userRepo, reminderQueue, lockTtlMs, FIXED_NOW);

      const before = await rawQueue.getDelayed();
      expect(before).toHaveLength(1);
      const oldScheduled = before[0].data.scheduledAt;

      const res = await supertest(app)
        .put(`/api/v1/users/${userId}`)
        .send({ timezone: 'America/New_York' });

      expect(res.status).toBe(200);

      const after = await rawQueue.getDelayed();
      expect(after).toHaveLength(0);

      const updatedUser = await userRepo.findById(userId);
      expect(updatedUser?.timezone).toBe('America/New_York');

      const newBirthday = DateTime
        .fromJSDate(updatedUser!.nextBirthDayAt)
        .setZone('America/New_York');
      expect(newBirthday.hour).toBe(config.birthdayHour);

      expect(updatedUser!.nextBirthDayAt.toISOString()).not.toBe(oldScheduled);
    });
  });

  // ─────────────────────────────────────────────
  // Scheduler Tick -> Queue
  // ─────────────────────────────────────────────

  describe('scheduler tick -> queue', () => {
    it('should enqueue jobs for users whose birthday falls within the next 8 hours', async () => {
      await userRepo.create({
        name:           'In Window',
        email:          'in@window.com',
        birthday:       new Date('1990-01-01'),
        timezone:       'UTC',
        nextBirthDayAt: inWindow(4), 
        active:         true,
      });

      await userRepo.create({
        name:           'Out Of Window',
        email:          'out@window.com',
        birthday:       new Date('1990-06-15'),
        timezone:       'UTC',
        nextBirthDayAt: outOfWindow(4), 
        active:         true,
      });

      await runSchedulerTick(redlock, userRepo, reminderQueue, lockTtlMs, FIXED_NOW);

      const delayed = await rawQueue.getDelayed();
      expect(delayed).toHaveLength(1);
      expect(delayed[0].data.userId).toBeDefined();

      await userRepo.findById(delayed[0].data.userId).then(user => {
        expect(user?.email).toBe('in@window.com');
      });
    });

    it('should not enqueue inactive users', async () => {
      await userRepo.create({
        name:           'Inactive User',
        email:          'inactive@test.com',
        birthday:       new Date('1990-01-01'),
        timezone:       'UTC',
        nextBirthDayAt: inWindow(2),   // inside window but inactive
        active:         false,
      });

      await runSchedulerTick(redlock, userRepo, reminderQueue, lockTtlMs, FIXED_NOW);

      const delayed = await rawQueue.getDelayed();
      expect(delayed).toHaveLength(0);
    });

    it('should not enqueue users whose nextBirthDayAt has already passed', async () => {
      await userRepo.create({
        name:           'Past Birthday',
        email:          'past@test.com',
        birthday:       new Date('1990-01-01'),
        timezone:       'UTC',
        nextBirthDayAt: inPast(1),   // 1 minute before FIXED_NOW
        active:         true,
      });

      await runSchedulerTick(redlock, userRepo, reminderQueue, lockTtlMs, FIXED_NOW);

      const delayed = await rawQueue.getDelayed();
      expect(delayed).toHaveLength(0);
    });

    it('should not enqueue duplicate jobs if scheduler tick runs twice', async () => {
      await userRepo.create({
        name:           'In Window',
        email:          'in@window.com',
        birthday:       new Date('1990-01-01'),
        timezone:       'UTC',
        nextBirthDayAt: inWindow(4),   // same fixed time both ticks
        active:         true,
      });

      await runSchedulerTick(redlock, userRepo, reminderQueue, lockTtlMs, FIXED_NOW);
      await runSchedulerTick(redlock, userRepo, reminderQueue, lockTtlMs, FIXED_NOW);

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

      await runSchedulerTick(redlock, userRepo, reminderQueue, lockTtlMs, FIXED_NOW);

      const delayed = await rawQueue.getDelayed();
      expect(delayed).toHaveLength(1);

      const jobId      = delayed[0].id!;
      const workerDone = waitForJob(worker, jobId);

      const originalNow = Date.now();

      Date.now = () => BIRTHDAY_FIRE_UTC.plus({ minutes: 1 }).toMillis();

      await delayed[0].changeDelay(0);
      await workerDone;

      Date.now = () => originalNow;

      // 1. Log file written
      const log = await readLogFile(logDir);
      expect(countLogEntries(log)).toBe(1);
      expect(log).toContain('Gojo Satoru');
      expect(log).toContain('gojo@jujutsu.com');

      // 2. nextBirthDayAt advanced to 2027 — verified against BIRTHDAY_FIRE_UTC, not DateTime.now()
      const userAfter = await userRepo.findById(userId);
      const advanced  = DateTime.fromJSDate(userAfter!.nextBirthDayAt).setZone(userAfter!.timezone);

      logger.warn('Advanced nextBirthDayAt', {
        advanced: advanced.toISO(),
        expected: BIRTHDAY_FIRE_UTC.plus({ years: 1 }).setZone(validPayload.timezone).toISO(),
      });
      expect(advanced.year).toBe(BIRTHDAY_FIRE_UTC.year + 1);  // 2027
      expect(advanced.month).toBe(BIRTHDAY_FIRE_UTC.setZone(validPayload.timezone).month);
      expect(advanced.day).toBe(BIRTHDAY_FIRE_UTC.setZone(validPayload.timezone).day);
      expect(advanced.hour).toBe(config.birthdayHour);

      // 3. Idempotency log created
      const logs = await mongoose.connection
        .collection('reminderlogs')
        .find({})
        .toArray();
      expect(logs).toHaveLength(1);
      expect(logs[0].userId.toString()).toBe(userId);
    });
    it('should not write to log file if user was deleted before job processed', async () => {
      const created = await userRepo.create({
        name:           validPayload.name,
        email:          validPayload.email,
        birthday:       new Date('1989-12-07'),
        timezone:       validPayload.timezone,
        nextBirthDayAt: inWindow(4),   // FIXED_NOW relative
        active:         true,
      });

      await runSchedulerTick(redlock, userRepo, reminderQueue, lockTtlMs, FIXED_NOW);
      const delayed = await rawQueue.getDelayed();

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
      const created = await userRepo.create({
        name:           validPayload.name,
        email:          validPayload.email,
        birthday:       new Date('1989-12-07'),
        timezone:       validPayload.timezone,
        nextBirthDayAt: inWindow(4),   // FIXED_NOW relative
        active:         true,
      });

      await runSchedulerTick(redlock, userRepo, reminderQueue, lockTtlMs, FIXED_NOW);
      const delayed    = await rawQueue.getDelayed();
      const jobId      = delayed[0].id!;
      const workerDone = waitForJob(worker, jobId);
      await delayed[0].changeDelay(0);
      await workerDone;

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
      const gojo = await userRepo.create({
        name:           'Gojo Satoru',
        email:          'gojo@jujutsu.com',
        birthday:       new Date('1989-12-07'),
        timezone:       'Asia/Tokyo',
        nextBirthDayAt: inWindow(3),
        active:         true,
      });
      const nanami = await userRepo.create({
        name:           'Nanami Kento',
        email:          'nanami@jujutsu.com',
        birthday:       new Date('1988-07-03'),
        timezone:       'Asia/Tokyo',
        nextBirthDayAt: inWindow(5),
        active:         true,
      });

      await runSchedulerTick(redlock, userRepo, reminderQueue, lockTtlMs, FIXED_NOW);

      const delayed = await rawQueue.getDelayed();
      expect(delayed).toHaveLength(2);

      const originalDateNow = Date.now;
      Date.now = () => BIRTHDAY_FIRE_UTC.plus({ minutes: 1 }).toMillis();

      const jobIds  = delayed.map(j => j.id!);
      const allDone = Promise.all(jobIds.map(id => waitForJob(worker, id)));
      await Promise.all(delayed.map(j => j.changeDelay(0)));
      await allDone;

      Date.now = originalDateNow;

      // 1. Log entries
      const log = await readLogFile(logDir);
      expect(countLogEntries(log)).toBe(2);
      expect(log).toContain('Gojo Satoru');
      expect(log).toContain('Nanami Kento');

      // 2. Both users' nextBirthDayAt advanced correctly
      const gojoAfter   = await userRepo.findById(gojo.id);
      const nanamiAfter = await userRepo.findById(nanami.id);

      const gojoAdvanced   = DateTime.fromJSDate(gojoAfter!.nextBirthDayAt).setZone('Asia/Tokyo');
      const nanamiAdvanced = DateTime.fromJSDate(nanamiAfter!.nextBirthDayAt).setZone('Asia/Tokyo');

      // Gojo — Dec 7, should advance to 2027
      expect(gojoAdvanced.year).toBe(BIRTHDAY_FIRE_UTC.year + 1);
      expect(gojoAdvanced.month).toBe(12);
      expect(gojoAdvanced.day).toBe(7);
      expect(gojoAdvanced.hour).toBe(config.birthdayHour);

      // Nanami — Jul 3, next occurrence after BIRTHDAY_FIRE_UTC (Dec 2026) is Jul 2027
      expect(nanamiAdvanced.year).toBe(BIRTHDAY_FIRE_UTC.year + 1);
      expect(nanamiAdvanced.month).toBe(7);
      expect(nanamiAdvanced.day).toBe(3);
      expect(nanamiAdvanced.hour).toBe(config.birthdayHour);

      // 3. Two idempotency logs created
      const logs = await mongoose.connection
        .collection('reminderlogs')
        .find({})
        .toArray();
      expect(logs).toHaveLength(2);
    });
  });
});