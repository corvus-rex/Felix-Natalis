import { UserService } from '../../../src/modules/user/service';
import { IUserRepository } from '../../../src/modules/user/repository';
import { UserError } from '../../../src/modules/user/error';
import { User } from '../../../src/modules/user/model';

// ─────────────────────────────────────────────
// Shared Fixtures
// ─────────────────────────────────────────────

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'userid-123',
  name: 'Gojo Satoru',
  email: 'gojo@test.com',
  birthday: new Date('1989-12-07'),
  timezone: 'Asia/Tokyo',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const registerPayload = {
  name: 'Gojo Satoru',
  email: 'gojo@test.com',
  birthday: new Date('1989-12-07'),
  timezone: 'Asia/Tokyo',
};

// ─────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────

describe('UserService', () => {
  let mockRepo: jest.Mocked<IUserRepository>;
  let service: UserService;

  beforeEach(() => {
    mockRepo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findActive: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    service = new UserService(mockRepo);
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
      expect(mockRepo.create).toHaveBeenCalledWith(registerPayload);
      expect(result).toEqual(createdUser);
    });

    it('should throw UserError DUPLICATE_EMAIL (409) if email is already registered', async () => {
      mockRepo.findByEmail.mockResolvedValue(makeUser());

      await expect(service.register(registerPayload)).rejects.toMatchObject({
        message: expect.stringContaining('Email'),
        code: 'DUPLICATE_EMAIL',
        status: 409,
      });

      // create should never be called
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('should rethrow unexpected errors from the repository as-is', async () => {
      const networkError = new Error('DB connection timeout');
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.create.mockRejectedValue(networkError);

      await expect(service.register(registerPayload)).rejects.toThrow('DB connection timeout');

      // Confirm it is NOT wrapped in UserError
      await expect(service.register(registerPayload)).rejects.not.toBeInstanceOf(UserError);
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

      // Passing the same email that the user already has
      await service.update('userid-123', { email: 'gojo@test.com' });

      expect(mockRepo.findByEmail).not.toHaveBeenCalled();
    });

    it('should check email uniqueness only when email actually changes', async () => {
      const existing = makeUser();
      const updated = makeUser({ email: 'new@test.com' });
      mockRepo.findById.mockResolvedValue(existing);
      mockRepo.findByEmail.mockResolvedValue(null); // new email is free
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
  });
});