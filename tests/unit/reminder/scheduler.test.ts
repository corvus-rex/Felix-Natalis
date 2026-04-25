// startBirthdayScheduler.test.ts
import cron from 'node-cron';
import { DateTime } from 'luxon';

import { startBirthdayScheduler, toCronExpression } from '../../../src/modules/reminder/scheduler.js';
import { logger } from '../../../src/infrastructure/logger.js';
import { config } from '../../../src/config/index.js';

jest.mock('node-cron', () => ({
  __esModule: true,
  default: {
    schedule: jest.fn(),
  },
}));

jest.mock('../../../src/infrastructure/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('startBirthdayScheduler', () => {
  let scheduledHandler: () => Promise<void>;

  const lock = {
    unlock: jest.fn(),
  };

  const redlock = {
    acquire: jest.fn(),
  };

  const userRepo = {
    findUsersWithBirthdayBetween: jest.fn(),
  };

  const queue = {
    add: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    (cron.schedule as jest.Mock).mockImplementation(
      (_expression: string, handler: () => Promise<void>) => {
        scheduledHandler = handler;
      },
    );

    redlock.acquire.mockResolvedValue(lock);
    lock.unlock.mockResolvedValue(undefined);
    userRepo.findUsersWithBirthdayBetween.mockResolvedValue([]);
    queue.add.mockResolvedValue(undefined);
  });

  it('registers hourly cron schedule', () => {
    startBirthdayScheduler(
      redlock as any,
      userRepo as any,
      queue as any,
    );
    const expectedExpression = toCronExpression(config.schedulingFrequency);
    expect(cron.schedule).toHaveBeenCalledWith(
      expectedExpression,
      expect.any(Function),
    );
  });

  it('acquires lock before processing', async () => {
    startBirthdayScheduler(
      redlock as any,
      userRepo as any,
      queue as any,
    );

    await scheduledHandler();

    expect(redlock.acquire).toHaveBeenCalledWith(
      ['locks:cron:birthday'],
      60_000,
    );
  });

  it('queries repository for birthdays in next 8 hours', async () => {
    const now = DateTime.utc();

    jest.spyOn(DateTime, 'utc').mockReturnValue(now);

    startBirthdayScheduler(
      redlock as any,
      userRepo as any,
      queue as any,
    );

    await scheduledHandler();

    expect(
      userRepo.findUsersWithBirthdayBetween,
    ).toHaveBeenCalledWith(
      now.toJSDate(),
      now.plus({ hours: 8 }).toJSDate(),
    );
  });

  it('queues users with future birthdays', async () => {
    const now = DateTime.utc();

    jest.spyOn(DateTime, 'utc').mockReturnValue(now);

    const nextBirthday = now.plus({ hours: 2 }).toJSDate();

    userRepo.findUsersWithBirthdayBetween.mockResolvedValue([
      {
        id: 'user-1',
        nextBirthDayAt: nextBirthday,
      },
    ]);

    startBirthdayScheduler(
      redlock as any,
      userRepo as any,
      queue as any,
    );

    await scheduledHandler();

    expect(queue.add).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        type: 'birthday',
        scheduledAt: DateTime.fromJSDate(nextBirthday)
          .toUTC()
          .toISO(),
      },
      expect.any(Number),
    );
  });

  it('does not queue users when delay is zero or negative', async () => {
    const now = DateTime.utc();

    jest.spyOn(DateTime, 'utc').mockReturnValue(now);

    userRepo.findUsersWithBirthdayBetween.mockResolvedValue([
      {
        id: 'user-1',
        nextBirthDayAt: now.minus({ minutes: 1 }).toJSDate(),
      },
    ]);

    startBirthdayScheduler(
      redlock as any,
      userRepo as any,
      queue as any,
    );

    await scheduledHandler();

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('logs warning when lock acquisition fails', async () => {
    redlock.acquire.mockRejectedValue(new Error('locked'));

    startBirthdayScheduler(
      redlock as any,
      userRepo as any,
      queue as any,
    );

    await scheduledHandler();

    expect(logger.warn).toHaveBeenCalledWith(
      'scheduler failed or lock not acquired',
      { err: expect.any(Error) },
    );
  });

  it('releases lock after successful run', async () => {
    startBirthdayScheduler(
      redlock as any,
      userRepo as any,
      queue as any,
    );

    await scheduledHandler();

    expect(lock.unlock).toHaveBeenCalledTimes(1);
  });

  it('logs error when unlock fails', async () => {
    lock.unlock.mockRejectedValue(new Error('unlock failed'));

    startBirthdayScheduler(
      redlock as any,
      userRepo as any,
      queue as any,
    );

    await scheduledHandler();

    expect(logger.error).toHaveBeenCalledWith(
      'failed to release lock',
      { err: expect.any(Error) },
    );
  });

  it('logs completion after processing users', async () => {
    userRepo.findUsersWithBirthdayBetween.mockResolvedValue([]);

    startBirthdayScheduler(
      redlock as any,
      userRepo as any,
      queue as any,
    );

    await scheduledHandler();

    expect(logger.info).toHaveBeenCalledWith(
      'birthday scheduler complete',
      { count: 0 },
    );
  });
});