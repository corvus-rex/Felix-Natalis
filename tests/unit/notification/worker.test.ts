import { ReminderJobProcessor } from '../../../src/modules/notification/worker';
import { IUserRepository }      from '../../../src/modules/user/repository';
import { IReminderRepository }  from '../../../src/modules/reminder/repository';
import { INotificationService } from '../../../src/modules/notification/service';
import { Job }                  from 'bullmq';
import { DateTime }             from 'luxon';
import * as localeUtils         from '../../../src/modules/notification/builder/birthday/locale/index';
import { computeNextBirthdayAt } from '../../../src/modules/reminder/birthdayUtils';

// ─────────────────────────────────────────────
// Shared Fixtures
// ─────────────────────────────────────────────

const SCHEDULED_AT   = '2026-12-07T09:00:00.000Z';
const NEXT_BIRTH_DAY = new Date('2026-12-07T09:00:00.000Z');

const makeUser = (overrides = {}) => ({
  id:            'userid-123',
  name:          'Gojo Satoru',
  email:         'gojo@jujutsu.com',
  timezone:      'Asia/Tokyo',
  birthday:      new Date('1995-12-07T00:00:00.000Z'),
  nextBirthDayAt: NEXT_BIRTH_DAY,
  active:        true,
  ...overrides,
});

const makeJob = (overrides: Partial<{
  userId:      string;
  type:        string;
  scheduledAt: string;
  attemptsMade: number;
}> = {}): Partial<Job> => ({
  data: {
    userId:      'userid-123',
    type:        'birthday',
    scheduledAt: SCHEDULED_AT,
    ...overrides,
  },
  attemptsMade: overrides.attemptsMade ?? 0,
});

// ─────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────

describe('ReminderJobProcessor', () => {
  let mockUserRepo:            jest.Mocked<IUserRepository>;
  let mockReminderRepo:        jest.Mocked<IReminderRepository>;
  let mockNotificationService: jest.Mocked<INotificationService>;
  let processor:               ReminderJobProcessor;

  beforeEach(() => {
    mockUserRepo = {
      create:                       jest.fn(),
      findById:                     jest.fn(),
      findByEmail:                  jest.fn(),
      update:                       jest.fn(),
      delete:                       jest.fn(),
      findUsersWithBirthdayBetween: jest.fn(),
    };

    mockReminderRepo = {
      claimReminder: jest.fn(),
    };

    mockNotificationService = {
      notifyBirthday: jest.fn().mockResolvedValue(undefined),
    };

    jest
      .spyOn(localeUtils, 'resolveLocaleFromTimezone')
      .mockReturnValue('en');

    processor = new ReminderJobProcessor(
      mockUserRepo,
      mockReminderRepo,
      mockNotificationService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ───────────────────────────────────────────
  // Step 1 — user lookup
  // ───────────────────────────────────────────

  describe('step 1: user lookup', () => {
    it('should fetch the user by userId from job data', async () => {
      mockUserRepo.findById.mockResolvedValue(makeUser() as any);
      mockReminderRepo.claimReminder.mockResolvedValue(true);

      await processor.process(makeJob() as Job);

      expect(mockUserRepo.findById).toHaveBeenCalledWith('userid-123');
    });

    it('should return early and skip all steps if user is not found', async () => {
      mockUserRepo.findById.mockResolvedValue(null);

      await processor.process(makeJob() as Job);

      expect(mockReminderRepo.claimReminder).not.toHaveBeenCalled();
      expect(mockNotificationService.notifyBirthday).not.toHaveBeenCalled();
      expect(mockUserRepo.update).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────
  // Step 2 — idempotency claim
  // ───────────────────────────────────────────

  describe('step 2: idempotency claim', () => {
    it('should claim the reminder with normalized scheduledAt', async () => {
      mockUserRepo.findById.mockResolvedValue(makeUser() as any);
      mockReminderRepo.claimReminder.mockResolvedValue(true);

      await processor.process(makeJob() as Job);

      expect(mockReminderRepo.claimReminder).toHaveBeenCalledWith(
        'userid-123',
        new Date(SCHEDULED_AT)
      );
    });

    it('should return early if reminder was already claimed', async () => {
      mockUserRepo.findById.mockResolvedValue(makeUser() as any);
      mockReminderRepo.claimReminder.mockResolvedValue(false);

      await processor.process(makeJob() as Job);

      expect(mockNotificationService.notifyBirthday).not.toHaveBeenCalled();
      expect(mockUserRepo.update).not.toHaveBeenCalled();
    });

    it('should normalize scheduledAt before claiming — same timestamp different format', async () => {
      // Both should resolve to the same ISO string
      mockUserRepo.findById.mockResolvedValue(makeUser() as any);
      mockReminderRepo.claimReminder.mockResolvedValue(true);

      await processor.process(makeJob({ scheduledAt: '2025-12-07T00:00:00Z' }) as Job);

      expect(mockReminderRepo.claimReminder).toHaveBeenCalledWith(
        'userid-123',
        new Date('2025-12-07T00:00:00.000Z')
      );
    });
  });

  // ───────────────────────────────────────────
  // Step 3 — type guard
  // ───────────────────────────────────────────

  describe('step 3: type guard', () => {
    it('should return early for unsupported reminder types', async () => {
      mockUserRepo.findById.mockResolvedValue(makeUser() as any);
      mockReminderRepo.claimReminder.mockResolvedValue(true);

      await processor.process(makeJob({ type: 'medicine' }) as Job);

      expect(mockNotificationService.notifyBirthday).not.toHaveBeenCalled();
      expect(mockUserRepo.update).not.toHaveBeenCalled();
    });

    it('should proceed for supported type "birthday"', async () => {
      mockUserRepo.findById.mockResolvedValue(makeUser() as any);
      mockReminderRepo.claimReminder.mockResolvedValue(true);

      await processor.process(makeJob({ type: 'birthday' }) as Job);

      expect(mockNotificationService.notifyBirthday).toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────
  // Step 4 — locale resolution
  // ───────────────────────────────────────────

  describe('step 4: locale resolution', () => {
    it('should resolve locale from user timezone', async () => {
      mockUserRepo.findById.mockResolvedValue(makeUser() as any);
      mockReminderRepo.claimReminder.mockResolvedValue(true);

      await processor.process(makeJob() as Job);

      expect(localeUtils.resolveLocaleFromTimezone).toHaveBeenCalledWith('Asia/Tokyo');
    });

    it('should pass resolved locale to notifyBirthday', async () => {
      mockUserRepo.findById.mockResolvedValue(makeUser() as any);
      mockReminderRepo.claimReminder.mockResolvedValue(true);

      await processor.process(makeJob() as Job);

      expect(mockNotificationService.notifyBirthday).toHaveBeenCalledWith(
        { userId: 'userid-123', name: 'Gojo Satoru', email: 'gojo@jujutsu.com' },
        'en'
      );
    });
  });

  // ───────────────────────────────────────────
  // Step 5 — send notification
  // ───────────────────────────────────────────

  describe('step 5: send notification', () => {
    it('should send notification with user name and email', async () => {
      mockUserRepo.findById.mockResolvedValue(makeUser() as any);
      mockReminderRepo.claimReminder.mockResolvedValue(true);

      await processor.process(makeJob() as Job);

      expect(mockNotificationService.notifyBirthday).toHaveBeenCalledWith(
        { userId: 'userid-123', name: 'Gojo Satoru', email: 'gojo@jujutsu.com' },
        expect.any(String)
      );
    });

    it('should throw and not update nextBirthDayAt if notification fails', async () => {
      mockUserRepo.findById.mockResolvedValue(makeUser() as any);
      mockReminderRepo.claimReminder.mockResolvedValue(true);
      mockNotificationService.notifyBirthday.mockRejectedValue(
        new Error('SMTP connection failed')
      );

      await expect(processor.process(makeJob() as Job)).rejects.toThrow('SMTP connection failed');

      // nextBirthDayAt must NOT be advanced if send failed
      expect(mockUserRepo.update).not.toHaveBeenCalled();
    });

    it('should rethrow the exact error from notifyBirthday', async () => {
      const smtpError = new Error('SMTP timeout');
      mockUserRepo.findById.mockResolvedValue(makeUser() as any);
      mockReminderRepo.claimReminder.mockResolvedValue(true);
      mockNotificationService.notifyBirthday.mockRejectedValue(smtpError);

      await expect(processor.process(makeJob() as Job)).rejects.toThrow(smtpError);
    });
  });

  // ───────────────────────────────────────────
  // Step 6 — advance nextBirthDayAt
  // ───────────────────────────────────────────

  describe('step 6: advance nextBirthDayAt', () => {
    it('should advance nextBirthDayAt by exactly one year after successful send', async () => {
      mockUserRepo.findById.mockResolvedValue(makeUser() as any);
      mockReminderRepo.claimReminder.mockResolvedValue(true);

      await processor.process(makeJob() as Job);

      const expectedNextBirthday = computeNextBirthdayAt(
        new Date('1989-12-07T00:00:00.000Z'),
        'Asia/Tokyo'
     );

      expect(mockUserRepo.update).toHaveBeenCalledWith(
        'userid-123',
        { nextBirthDayAt: expectedNextBirthday }
      );
    });

    it('should update only after notification succeeds — not before', async () => {
      const callOrder: string[] = [];

      mockUserRepo.findById.mockResolvedValue(makeUser() as any);
      mockReminderRepo.claimReminder.mockResolvedValue(true);
      mockNotificationService.notifyBirthday.mockImplementation(async () => {
        callOrder.push('notify');
      });
      mockUserRepo.update.mockImplementation(async () => {
        callOrder.push('update');
        return makeUser() as any;
      });

      await processor.process(makeJob() as Job);

      expect(callOrder).toEqual(['notify', 'update']);
    });

    it('should not update nextBirthDayAt if notification throws', async () => {
      mockUserRepo.findById.mockResolvedValue(makeUser() as any);
      mockReminderRepo.claimReminder.mockResolvedValue(true);
      mockNotificationService.notifyBirthday.mockRejectedValue(new Error('failed'));

      await expect(processor.process(makeJob() as Job)).rejects.toThrow();

      expect(mockUserRepo.update).not.toHaveBeenCalled();
    });

    it('should preserve month and day when advancing year', async () => {
      const dec7 = new Date('2025-12-07T00:00:00.000Z');
      mockUserRepo.findById.mockResolvedValue(makeUser({ nextBirthDayAt: dec7 }) as any);
      mockReminderRepo.claimReminder.mockResolvedValue(true);

      await processor.process(makeJob() as Job);

      const updateCall = mockUserRepo.update.mock.calls[0][1] as any;
      const advanced   = DateTime.fromJSDate(updateCall.nextBirthDayAt);

      expect(advanced.month).toBe(12);
      expect(advanced.day).toBe(7);
      expect(advanced.year).toBe(2026);
    });
  });

    // ───────────────────────────────────────────
    // Leap year edge cases
    // ───────────────────────────────────────────

    describe('leap year handling', () => {
        it('should fall back to Feb 28 when advancing a Feb 29 birthday to a non-leap year', async () => {
            // 2024 is a leap year — user's birthday is Feb 29
            const feb29 = new Date('2024-02-29T00:00:00.000Z');
            mockUserRepo.findById.mockResolvedValue(
            makeUser({ birthday: feb29, nextBirthDayAt: feb29 }) as any
            );
            mockReminderRepo.claimReminder.mockResolvedValue(true);

            await processor.process(makeJob() as Job);

            const updateCall = mockUserRepo.update.mock.calls[0][1] as any;
            const advanced = DateTime.fromJSDate(updateCall.nextBirthDayAt);

            expect(advanced.month).toBe(2);
            expect(advanced.day).toBe(28);
            const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
            expect(isLeapYear(advanced.year)).toBe(false);
            expect(advanced.month).not.toBe(3);
            expect(advanced.day).not.toBe(1);
        });

        it('should use Feb 29 when advancing a Feb 29 birthday to a leap year', async () => {
            // 2020 is a leap year — next leap year after is 2024
            const feb29 = new Date('2020-02-29T00:00:00.000Z');
            mockUserRepo.findById.mockResolvedValue(
            makeUser({ birthday: feb29, nextBirthDayAt: feb29 }) as any
            );
            mockReminderRepo.claimReminder.mockResolvedValue(true);

            await processor.process(makeJob() as Job);

            const updateCall = mockUserRepo.update.mock.calls[0][1] as any;
            const advanced = DateTime.fromJSDate(updateCall.nextBirthDayAt);

            // Next year after 2020 Feb 29 job fires is 2021 — not a leap year, falls back to Feb 28
            expect(advanced.month).toBe(2);
            expect(advanced.day).toBe(28);
            expect(advanced.month).not.toBe(3);
            expect(advanced.day).not.toBe(1);
        });

        it('should use Feb 29 when the next year happens to be a leap year', async () => {
            // Pin "now" to March 2027 so computeNextBirthdayAt resolves to Feb 29 2028 (leap year)
            jest.spyOn(DateTime, 'now').mockReturnValue(
                DateTime.fromISO('2027-03-01T00:00:00.000Z') as any
            );

            const feb29 = new Date('2000-02-29T00:00:00.000Z');
            mockUserRepo.findById.mockResolvedValue(
                makeUser({ birthday: feb29, nextBirthDayAt: feb29 }) as any
            );
            mockReminderRepo.claimReminder.mockResolvedValue(true);

            await processor.process(makeJob() as Job);

            const updateCall = mockUserRepo.update.mock.calls[0][1] as any;
            const advanced = DateTime.fromJSDate(updateCall.nextBirthDayAt).setZone('Asia/Tokyo');

            // 2028 is a leap year — real Feb 29 should be used
            expect(advanced.year).toBe(2028);
            expect(advanced.month).toBe(2);
            expect(advanced.day).toBe(29);
        });

        it('should never advance to March 1 for a Feb 29 birthday', async () => {
            const feb29 = new Date('2024-02-29T00:00:00.000Z');
            mockUserRepo.findById.mockResolvedValue(
            makeUser({ birthday: feb29, nextBirthDayAt: feb29 }) as any
            );
            mockReminderRepo.claimReminder.mockResolvedValue(true);

            await processor.process(makeJob() as Job);

            const updateCall = mockUserRepo.update.mock.calls[0][1] as any;
            const advanced = DateTime.fromJSDate(updateCall.nextBirthDayAt);

            expect(advanced.month).not.toBe(3);
            expect(advanced.day).not.toBe(1);
        });
    });

    // ───────────────────────────────────────────
    // Full happy path
    // ───────────────────────────────────────────

    describe('happy path', () => {
        it('should execute all steps in order for a valid birthday job', async () => {
        const callOrder: string[] = [];

        mockUserRepo.findById.mockImplementation(async () => {
            callOrder.push('findById');
            return makeUser() as any;
        });
        mockReminderRepo.claimReminder.mockImplementation(async () => {
            callOrder.push('claimReminder');
            return true;
        });
        mockNotificationService.notifyBirthday.mockImplementation(async () => {
            callOrder.push('notifyBirthday');
        });
        mockUserRepo.update.mockImplementation(async () => {
            callOrder.push('update');
            return makeUser() as any;
        });

        await processor.process(makeJob() as Job);

        expect(callOrder).toEqual([
            'findById',
            'claimReminder',
            'notifyBirthday',
            'update',
        ]);
        });

        it('should resolve without throwing on complete success', async () => {
        mockUserRepo.findById.mockResolvedValue(makeUser() as any);
        mockReminderRepo.claimReminder.mockResolvedValue(true);

        await expect(processor.process(makeJob() as Job)).resolves.toBeUndefined();
        });
    });
});