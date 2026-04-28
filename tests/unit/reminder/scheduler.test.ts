import { toCronExpression, runSchedulerTick } from '../../../src/modules/reminder/scheduler.js';
import { IUserRepository }  from '../../../src/modules/user/repository.js';
import { IReminderQueue }   from '../../../src/modules/reminder/model.js';
import { DateTime }         from 'luxon';
import { User } from '../../../src/modules/user/model.js';

// ─────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'userid-123',
  name: 'Gojo Satoru',
  email: 'gojo@test.com',
  birthday: new Date('1989-12-07'),
  timezone: 'Asia/Tokyo',
  active: true,
  nextBirthDayAt: new Date('2026-12-07T09:00:00.000Z'),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeMockRedlock = (shouldFail = false) => ({
  acquire: jest.fn().mockImplementation(() =>
    shouldFail
      ? Promise.reject(new Error('lock not available'))
      : Promise.resolve({ unlock: jest.fn().mockResolvedValue(undefined) })
  ),
});

// ─────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────

describe('scheduler', () => {
  let mockUserRepo: jest.Mocked<IUserRepository>;
  let mockQueue:    jest.Mocked<IReminderQueue>;

  beforeEach(() => {
    mockUserRepo = {
      create:                      jest.fn(),
      findById:                    jest.fn(),
      findByEmail:                 jest.fn(),
      findUsersWithBirthdayBetween: jest.fn(),
      update:                      jest.fn(),
      delete:                      jest.fn(),
    };

    mockQueue = {
      add:                    jest.fn().mockResolvedValue(undefined),
      addBulk:                jest.fn().mockResolvedValue(undefined),
      removeById:             jest.fn().mockResolvedValue(undefined),
      removeBirthdayReminder: jest.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => jest.clearAllMocks());

  // ───────────────────────────────────────────
  // toCronExpression()
  // ───────────────────────────────────────────

  describe('toCronExpression()', () => {
    it.each([
      [1,  '0 * * * *'],
      [2,  '0 */2 * * *'],
      [3,  '0 */3 * * *'],
      [6,  '0 */6 * * *'],
    ])('should return %s for frequency %ih', (freq, expected) => {
      expect(toCronExpression(freq)).toBe(expected);
    });

    it('should fall back to hourly for unsupported frequency', () => {
      expect(toCronExpression(5)).toBe('0 * * * *');
      expect(toCronExpression(7)).toBe('0 * * * *');
      expect(toCronExpression(0)).toBe('0 * * * *');
    });
  });

  // ───────────────────────────────────────────
  // runSchedulerTick() — lock
  // ───────────────────────────────────────────

  describe('runSchedulerTick() — lock', () => {
    it('should acquire lock with correct key and ttl', async () => {
      const redlock = makeMockRedlock();
      mockUserRepo.findUsersWithBirthdayBetween.mockResolvedValue([]);

      await runSchedulerTick(redlock as any, mockUserRepo, mockQueue, 120_000);

      expect(redlock.acquire).toHaveBeenCalledWith(
        ['locks:cron:birthday'],
        120_000
      );
    });

    it('should release lock after successful run', async () => {
      const lock    = { unlock: jest.fn().mockResolvedValue(undefined) };
      const redlock = { acquire: jest.fn().mockResolvedValue(lock) };
      mockUserRepo.findUsersWithBirthdayBetween.mockResolvedValue([]);

      await runSchedulerTick(redlock as any, mockUserRepo, mockQueue, 120_000);

      expect(lock.unlock).toHaveBeenCalledTimes(1);
    });

    it('should release lock even if processing throws', async () => {
      const lock    = { unlock: jest.fn().mockResolvedValue(undefined) };
      const redlock = { acquire: jest.fn().mockResolvedValue(lock) };
      mockUserRepo.findUsersWithBirthdayBetween.mockRejectedValue(
        new Error('DB down')
      );

      await runSchedulerTick(redlock as any, mockUserRepo, mockQueue, 120_000);

      expect(lock.unlock).toHaveBeenCalledTimes(1);
    });

    it('should not enqueue any jobs if lock cannot be acquired', async () => {
      const redlock = makeMockRedlock(true); // fails to acquire

      await runSchedulerTick(redlock as any, mockUserRepo, mockQueue, 120_000);

      expect(mockUserRepo.findUsersWithBirthdayBetween).not.toHaveBeenCalled();
      expect(mockQueue.addBulk).not.toHaveBeenCalled();
    });

    it('should handle unlock failure gracefully without throwing', async () => {
      const lock    = { unlock: jest.fn().mockRejectedValue(new Error('unlock failed')) };
      const redlock = { acquire: jest.fn().mockResolvedValue(lock) };
      mockUserRepo.findUsersWithBirthdayBetween.mockResolvedValue([]);

      // Should not throw even if unlock fails
      await expect(
        runSchedulerTick(redlock as any, mockUserRepo, mockQueue, 120_000)
      ).resolves.toBeUndefined();
    });
  });

  // ───────────────────────────────────────────
  // runSchedulerTick() — job building
  // ───────────────────────────────────────────

  describe('runSchedulerTick() — job building', () => {
    it('should enqueue a job for a user within the window', async () => {
      const redlock = makeMockRedlock();
      const user    = makeUser();
      mockUserRepo.findUsersWithBirthdayBetween.mockResolvedValueOnce([user])
                                               .mockResolvedValueOnce([]);

      await runSchedulerTick(redlock as any, mockUserRepo, mockQueue, 120_000);

      expect(mockQueue.addBulk).toHaveBeenCalledTimes(1);
      const jobs = mockQueue.addBulk.mock.calls[0][0];
      expect(jobs).toHaveLength(1);
      expect(jobs[0].data.userId).toBe('userid-123');
      expect(jobs[0].data.type).toBe('birthday');
      expect(jobs[0].delay).toBeGreaterThan(0);
    });

    it('should set scheduledAt as normalized ISO string', async () => {
      const redlock = makeMockRedlock();
      mockUserRepo.findUsersWithBirthdayBetween.mockResolvedValueOnce([makeUser()])
                                               .mockResolvedValueOnce([]);

      await runSchedulerTick(redlock as any, mockUserRepo, mockQueue, 120_000);

      const jobs = mockQueue.addBulk.mock.calls[0][0];
      expect(() => new Date(jobs[0].data.scheduledAt)).not.toThrow();
      expect(jobs[0].data.scheduledAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should skip users with delay <= 0 (birthday already passed)', async () => {
      const redlock  = makeMockRedlock();
      const pastUser = makeUser({
        nextBirthDayAt: DateTime.utc().minus({ hours: 1 }).toJSDate() // in the past
      });
      mockUserRepo.findUsersWithBirthdayBetween.mockResolvedValueOnce([pastUser])
                                               .mockResolvedValueOnce([]);

      await runSchedulerTick(redlock as any, mockUserRepo, mockQueue, 120_000);

      expect(mockQueue.addBulk).not.toHaveBeenCalled();
    });

    it('should skip users with invalid nextBirthDayAt', async () => {
      const redlock     = makeMockRedlock();
      const invalidUser = makeUser({
        nextBirthDayAt: new Date('invalid-date')
      });
      mockUserRepo.findUsersWithBirthdayBetween.mockResolvedValueOnce([invalidUser])
                                               .mockResolvedValueOnce([]);

      await runSchedulerTick(redlock as any, mockUserRepo, mockQueue, 120_000);

      expect(mockQueue.addBulk).not.toHaveBeenCalled();
    });

    it('should not call addBulk if all users in batch are skipped', async () => {
      const redlock = makeMockRedlock();
      const pastUser = makeUser({
        nextBirthDayAt: DateTime.utc().minus({ minutes: 1 }).toJSDate()
      });
      mockUserRepo.findUsersWithBirthdayBetween.mockResolvedValueOnce([pastUser])
                                               .mockResolvedValueOnce([]);

      await runSchedulerTick(redlock as any, mockUserRepo, mockQueue, 120_000);

      expect(mockQueue.addBulk).not.toHaveBeenCalled();
    });

    it('should enqueue multiple users in a single addBulk call', async () => {
      const redlock = makeMockRedlock();
      const users   = [
        makeUser({ id: 'user-1', nextBirthDayAt: DateTime.utc().plus({ hours: 2 }).toJSDate() }),
        makeUser({ id: 'user-2', nextBirthDayAt: DateTime.utc().plus({ hours: 4 }).toJSDate() }),
        makeUser({ id: 'user-3', nextBirthDayAt: DateTime.utc().plus({ hours: 6 }).toJSDate() }),
      ];
      mockUserRepo.findUsersWithBirthdayBetween.mockResolvedValueOnce(users)
                                               .mockResolvedValueOnce([]);

      await runSchedulerTick(redlock as any, mockUserRepo, mockQueue, 120_000);

      const jobs = mockQueue.addBulk.mock.calls[0][0];
      expect(jobs).toHaveLength(3);
      expect(jobs.map((j: any) => j.data.userId)).toEqual(['user-1', 'user-2', 'user-3']);
    });
  });

  // ───────────────────────────────────────────
  // runSchedulerTick() — pagination
  // ───────────────────────────────────────────

  describe('runSchedulerTick() — pagination', () => {
    it('should stop pagination when batch returns empty', async () => {
      const redlock = makeMockRedlock();
      mockUserRepo.findUsersWithBirthdayBetween.mockResolvedValue([]);

      await runSchedulerTick(redlock as any, mockUserRepo, mockQueue, 120_000);

      expect(mockUserRepo.findUsersWithBirthdayBetween).toHaveBeenCalledTimes(1);
    });

    it('should continue paginating while batch size equals queryBatchSize', async () => {
      const redlock = makeMockRedlock();

      // First batch — full page, triggers next fetch
      const batch1 = Array.from({ length: 10 }, (_, i) =>
        makeUser({
          id:            `user-batch1-${i}`,
          nextBirthDayAt: DateTime.utc().plus({ hours: i + 1 }).toJSDate(),
        })
      );

      // Second batch — partial page, stops pagination
      const batch2 = [
        makeUser({
          id:            'user-batch2-0',
          nextBirthDayAt: DateTime.utc().plus({ hours: 5 }).toJSDate(),
        })
      ];

      mockUserRepo.findUsersWithBirthdayBetween
        .mockResolvedValueOnce(batch1)
        .mockResolvedValueOnce(batch2)
        .mockResolvedValueOnce([]);

      // Mock queryBatchSize to 10
      jest.replaceProperty(
        (await import('../../../src/config/index.js')).config,
        'queryBatchSize',
        10
      );

      await runSchedulerTick(redlock as any, mockUserRepo, mockQueue, 120_000);

      expect(mockUserRepo.findUsersWithBirthdayBetween).toHaveBeenCalledTimes(2);
    });

    it('should pass cursor from last item of previous batch', async () => {
      const redlock = makeMockRedlock();

      const batch1 = Array.from({ length: 10 }, (_, i) =>
        makeUser({
          id:            `user-${i}`,
          nextBirthDayAt: DateTime.utc().plus({ hours: i + 1 }).toJSDate(),
        })
      );

      mockUserRepo.findUsersWithBirthdayBetween
        .mockResolvedValueOnce(batch1)
        .mockResolvedValueOnce([]);

      jest.replaceProperty(
        (await import('../../../src/config/index.js')).config,
        'queryBatchSize',
        10
      );

      await runSchedulerTick(redlock as any, mockUserRepo, mockQueue, 120_000);

      // Second call should receive the last user's id as cursor
      expect(mockUserRepo.findUsersWithBirthdayBetween).toHaveBeenNthCalledWith(
        2,
        expect.any(Date),
        expect.any(Date),
        'user-9'  // last item of batch1
      );
    });

    it('should accumulate total enqueued across all pages', async () => {
      const redlock = makeMockRedlock();

      const batch1 = Array.from({ length: 10 }, (_, i) =>
        makeUser({
          id:            `user-b1-${i}`,
          nextBirthDayAt: DateTime.utc().plus({ hours: i + 1 }).toJSDate(),
        })
      );

      const batch2 = Array.from({ length: 5 }, (_, i) =>
        makeUser({
          id:            `user-b2-${i}`,
          nextBirthDayAt: DateTime.utc().plus({ hours: i + 1 }).toJSDate(),
        })
      );

      mockUserRepo.findUsersWithBirthdayBetween
        .mockResolvedValueOnce(batch1)
        .mockResolvedValueOnce(batch2)
        .mockResolvedValueOnce([]);

      jest.replaceProperty(
        (await import('../../../src/config/index.js')).config,
        'queryBatchSize',
        10
      );

      await runSchedulerTick(redlock as any, mockUserRepo, mockQueue, 120_000);

      // addBulk called twice — once per batch
      expect(mockQueue.addBulk).toHaveBeenCalledTimes(2);
      const totalJobs =
        mockQueue.addBulk.mock.calls[0][0].length +
        mockQueue.addBulk.mock.calls[1][0].length;
      expect(totalJobs).toBe(15);
    });
  });
});