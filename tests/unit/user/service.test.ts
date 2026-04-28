import { UserService } from '../../../src/modules/user/service';
import { IUserRepository } from '../../../src/modules/user/repository';
import { IReminderQueue } from '../../../src/modules/reminder/model';
import { UserError } from '../../../src/modules/user/error';
import { User } from '../../../src/modules/user/model';
import * as birthdayUtils from '../../../src/modules/reminder/birthdayUtils';
import { remove } from 'winston';

// ─────────────────────────────────────────────
// Shared Fixtures
// ─────────────────────────────────────────────
const FIXED_NOW = new Date('2026-04-24T08:25:55.557Z');

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'userid-123',
  name: 'Gojo Satoru',
  email: 'gojo@test.com',
  birthday: new Date('1989-12-07'),
  timezone: 'Asia/Tokyo',
  active: true,
  nextBirthDayAt: new Date('2026-12-07T09:00:00.000Z'),
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
  ...overrides,
});

const registerPayload = {
  name: 'Gojo Satoru',
  email: 'gojo@test.com',
  birthday: new Date('1989-12-07'),
  timezone: 'Asia/Tokyo',
};

const MOCK_NEXT_BIRTHDAY = new Date('2026-12-07T19:00:00.000Z');


const insertPayload = {
  ...registerPayload,
  nextBirthDayAt: MOCK_NEXT_BIRTHDAY,
  active: true,
};

// ─────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────

describe('UserService', () => {
  let mockRepo: jest.Mocked<IUserRepository>;
  let mockQueue: jest.Mocked<IReminderQueue>;
  let service: UserService;

  beforeEach(() => {
    mockRepo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByEmail: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUsersWithBirthdayBetween: jest.fn(),
    };

    mockQueue = {
      add: jest.fn(),
      removeById: jest.fn(),
      removeBirthdayReminder: jest.fn().mockResolvedValue(undefined),
    };

    // Spy on computeNextBirthdayAt so we control its output
    // and can assert it was called correctly
    jest
      .spyOn(birthdayUtils, 'computeNextBirthdayAt')
      .mockReturnValue(MOCK_NEXT_BIRTHDAY);

    service = new UserService(mockRepo, mockQueue);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ───────────────────────────────────────────
  // register()
  // ───────────────────────────────────────────

  describe('register()', () => {
    it('should register a new user and return the created user', async () => {
      const createdUser = makeUser();
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(createdUser);

      const result = await service.register(registerPayload);

      expect(mockRepo.findByEmail).toHaveBeenCalledWith('gojo@test.com');
      expect(mockRepo.create).toHaveBeenCalledWith(insertPayload); 
      expect(result).toEqual(createdUser);
    });

    it('should throw UserError DUPLICATE_EMAIL (409) if email is already registered', async () => {
      mockRepo.findByEmail.mockResolvedValue(makeUser());

      await expect(service.register(registerPayload)).rejects.toMatchObject({
        message: expect.stringContaining('Email'),
        code: 'DUPLICATE_EMAIL',
        status: 409,
      });

      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('should rethrow unexpected errors from the repository as-is', async () => {
      const networkError = new Error('DB connection timeout');
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.create.mockRejectedValue(networkError);

      await expect(service.register(registerPayload)).rejects.toThrow('DB connection timeout');
      await expect(service.register(registerPayload)).rejects.not.toBeInstanceOf(UserError);
    });

    it('should compute nextBirthdayAt and pass it to create', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(makeUser());

      await service.register(registerPayload);

      expect(birthdayUtils.computeNextBirthdayAt).toHaveBeenCalledWith(
        registerPayload.birthday,
        registerPayload.timezone
      );

      expect(mockRepo.create).toHaveBeenCalledWith(insertPayload);
    });

    it('should throw DUPLICATE_EMAIL (409) on MongoDB duplicate key error (code 11000)', async () => {
      const mongoError = Object.assign(new Error('duplicate key'), { code: 11000 });
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.create.mockRejectedValue(mongoError);

      await expect(service.register(registerPayload)).rejects.toMatchObject({
        code: 'DUPLICATE_EMAIL',
        status: 409,
      });
    });

    it('should not wrap non-11000 DB errors as DUPLICATE_EMAIL', async () => {
      const otherDbError = Object.assign(new Error('write conflict'), { code: 112 });
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.create.mockRejectedValue(otherDbError);

      await expect(service.register(registerPayload)).rejects.not.toMatchObject({
        code: 'DUPLICATE_EMAIL',
      });
    });
  });

  // ───────────────────────────────────────────
  // getById()
  // ───────────────────────────────────────────

  describe('getById()', () => {
    it('should return the user when found', async () => {
      const user = makeUser();
      mockRepo.findById.mockResolvedValue(user);

      const result = await service.getById('userid-123');

      expect(mockRepo.findById).toHaveBeenCalledWith('userid-123');
      expect(result).toEqual(user);
    });

    it('should throw UserError NOT_FOUND (404) when user does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.getById('ghost-id')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });
  });

  // ───────────────────────────────────────────
  // update()
  // ───────────────────────────────────────────

  describe('update()', () => {
    it('should update and return the updated user', async () => {
      const existing = makeUser();
      const updated = makeUser({ name: 'Gojo Updated' });
      mockRepo.findById.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(updated);

      const result = await service.update('userid-123', { name: 'Gojo Updated' });

      expect(mockRepo.findById).toHaveBeenCalledWith('userid-123');
      expect(mockRepo.update).toHaveBeenCalledWith('userid-123', { name: 'Gojo Updated' });
      expect(result.name).toBe('Gojo Updated');
    });

    it('should throw NOT_FOUND (404) if user does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.update('ghost-id', { name: 'X' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });

      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('should throw DUPLICATE_EMAIL (409) if new email is already taken by another user', async () => {
      const existing = makeUser();
      const otherUser = makeUser({ id: 'other-456', email: 'taken@test.com' });
      mockRepo.findById.mockResolvedValue(existing);
      mockRepo.findByEmail.mockResolvedValue(otherUser);

      await expect(service.update('userid-123', { email: 'taken@test.com' })).rejects.toMatchObject({
        code: 'DUPLICATE_EMAIL',
        status: 409,
      });

      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('should NOT check email uniqueness if the email is unchanged', async () => {
      const existing = makeUser();
      mockRepo.findById.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(existing);

      await service.update('userid-123', { email: 'gojo@test.com' });

      expect(mockRepo.findByEmail).not.toHaveBeenCalled();
    });

    it('should check email uniqueness only when email actually changes', async () => {
      const existing = makeUser();
      const updated = makeUser({ email: 'new@test.com' });
      mockRepo.findById.mockResolvedValue(existing);
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.update.mockResolvedValue(updated);

      const result = await service.update('userid-123', { email: 'new@test.com' });

      expect(mockRepo.findByEmail).toHaveBeenCalledWith('new@test.com');
      expect(result.email).toBe('new@test.com');
    });

    it('should throw UPDATE_FAILED (500) if repository returns null after update', async () => {
      mockRepo.findById.mockResolvedValue(makeUser());
      mockRepo.update.mockResolvedValue(null);

      await expect(service.update('userid-123', { name: 'X' })).rejects.toMatchObject({
        code: 'UPDATE_FAILED',
        status: 500,
      });
    });

 
    it('should recompute nextBirthdayAt and remove old reminder when birthday changes', async () => {
      const existing = makeUser();
      const updated = makeUser({ birthday: new Date('1989-12-08') });
      mockRepo.findById.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(updated);

      await service.update('userid-123', { birthday: new Date('1989-12-08') });

      expect(birthdayUtils.computeNextBirthdayAt).toHaveBeenCalledWith(
        new Date('1989-12-08'),
        existing.timezone 
      );
      expect(mockQueue.removeBirthdayReminder).toHaveBeenCalledWith(
        'userid-123',
        existing.nextBirthDayAt.toISOString()
      );
      expect(mockRepo.update).toHaveBeenCalledWith(
        'userid-123',
        expect.objectContaining({ nextBirthDayAt: MOCK_NEXT_BIRTHDAY })
      );
    });

    it('should recompute nextBirthdayAt and remove old reminder when timezone changes', async () => {
      const existing = makeUser();
      const updated = makeUser({ timezone: 'America/New_York' });
      mockRepo.findById.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(updated);

      await service.update('userid-123', { timezone: 'America/New_York' });

      expect(birthdayUtils.computeNextBirthdayAt).toHaveBeenCalledWith(
        existing.birthday, 
        'America/New_York'
      );
      expect(mockQueue.removeBirthdayReminder).toHaveBeenCalledWith(
        'userid-123',
        existing.nextBirthDayAt.toISOString()
      );
    });

    it('should NOT recompute nextBirthdayAt or remove reminder for unrelated field updates', async () => {
      const existing = makeUser();
      mockRepo.findById.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(makeUser({ name: 'New Name' }));

      await service.update('userid-123', { name: 'New Name' });

      expect(birthdayUtils.computeNextBirthdayAt).not.toHaveBeenCalled();
      expect(mockQueue.removeBirthdayReminder).not.toHaveBeenCalled();
    });

    it('should NOT call update if removeBirthdayReminder throws', async () => {
      mockRepo.findById.mockResolvedValue(makeUser());
      mockQueue.removeBirthdayReminder.mockRejectedValue(new Error('Redis down'));

      await expect(
        service.update('userid-123', { birthday: new Date('1989-12-08') })
      ).rejects.toThrow('Redis down');

      expect(mockRepo.update).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────
  // deactivate()
  // ───────────────────────────────────────────

  describe('deactivate()', () => {
    it('should deactivate user and resolve with void', async () => {
      mockRepo.update.mockResolvedValue(makeUser({ active: false }));

      await expect(service.deactivate('userid-123')).resolves.toBeUndefined();
      expect(mockRepo.update).toHaveBeenCalledWith('userid-123', { active: false });
    });

    it('should throw NOT_FOUND (404) if the user does not exist', async () => {
      mockRepo.update.mockResolvedValue(null);

      await expect(service.deactivate('ghost-id')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });

    it('should always pass { active: false } regardless of current state', async () => {
      mockRepo.update.mockResolvedValue(makeUser({ active: false }));

      await service.deactivate('userid-123');

      expect(mockRepo.update).toHaveBeenCalledWith('userid-123', { active: false });
    });

 
    it('should remove birthday reminder after deactivating', async () => {
      const deactivated = makeUser({ active: false });
      mockRepo.update.mockResolvedValue(deactivated);

      await service.deactivate('userid-123');

      expect(mockQueue.removeBirthdayReminder).toHaveBeenCalledWith(
        'userid-123',
        deactivated.nextBirthDayAt.toISOString()
      );
    });

    it('should NOT remove reminder if update returns null (user not found)', async () => {
      mockRepo.update.mockResolvedValue(null);

      await expect(service.deactivate('ghost-id')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      expect(mockQueue.removeBirthdayReminder).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────
  // activate()
  // ───────────────────────────────────────────

  describe('activate()', () => {
    it('should activate user and resolve with void', async () => {
      mockRepo.update.mockResolvedValue(makeUser({ active: true }));

      await expect(service.activate('userid-123')).resolves.toBeUndefined();
      expect(mockRepo.update).toHaveBeenCalledWith('userid-123', { active: true });
    });

    it('should throw NOT_FOUND (404) if the user does not exist', async () => {
      mockRepo.update.mockResolvedValue(null);

      await expect(service.activate('ghost-id')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });

    it('should always pass { active: true } regardless of current state', async () => {
      mockRepo.update.mockResolvedValue(makeUser({ active: true }));

      await service.activate('userid-123');

      expect(mockRepo.update).toHaveBeenCalledWith('userid-123', { active: true });
    });

 
    it('should NOT call removeBirthdayReminder on activate', async () => {
      mockRepo.update.mockResolvedValue(makeUser({ active: true }));

      await service.activate('userid-123');

      expect(mockQueue.removeBirthdayReminder).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────
  // delete()
  // ───────────────────────────────────────────

  describe('delete()', () => {
    it('should delete user and resolve with void', async () => {
      mockRepo.findById.mockResolvedValue(makeUser());
      mockRepo.delete.mockResolvedValue(undefined);

      await expect(service.delete('userid-123')).resolves.toBeUndefined();
      expect(mockRepo.findById).toHaveBeenCalledWith('userid-123');
      expect(mockRepo.delete).toHaveBeenCalledWith('userid-123');
    });

    it('should throw NOT_FOUND (404) if user does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.delete('ghost-id')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });

      expect(mockRepo.delete).not.toHaveBeenCalled();
    });

    it('should NOT call delete if the guard findById throws', async () => {
      mockRepo.findById.mockRejectedValue(new Error('DB down'));

      await expect(service.delete('user-123')).rejects.toThrow('DB down');
      expect(mockRepo.delete).not.toHaveBeenCalled();
    });

 
    it('should remove birthday reminder after deleting', async () => {
      const existing = makeUser();
      mockRepo.findById.mockResolvedValue(existing);
      mockRepo.delete.mockResolvedValue(undefined);

      await service.delete('userid-123');

      expect(mockQueue.removeBirthdayReminder).toHaveBeenCalledWith(
        'userid-123',
        existing.nextBirthDayAt.toISOString()
      );
    });

    it('should NOT remove reminder if user is not found', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.delete('ghost-id')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      expect(mockQueue.removeBirthdayReminder).not.toHaveBeenCalled();
    });

    it('should NOT call removeBirthdayReminder if delete throws', async () => {
      mockRepo.findById.mockResolvedValue(makeUser());
      mockRepo.delete.mockRejectedValue(new Error('DB down'));

      await expect(service.delete('userid-123')).rejects.toThrow('DB down');

      expect(mockQueue.removeBirthdayReminder).not.toHaveBeenCalled();
    });
  });
});