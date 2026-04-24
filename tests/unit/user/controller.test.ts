import { UserController } from '../../../src/modules/user/controller';
import { IUserService } from '../../../src/modules/user/service';
import { UserError } from '../../../src/modules/user/error';
import { User } from '../../../src/modules/user/model';
import { Request, Response } from 'express';

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
  nextBirthDayAt: new Date('2025-12-07T09:00:00.000Z'),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// ─────────────────────────────────────────────
// HTTP Mock Factories
// ─────────────────────────────────────────────

const makeMockReq = (overrides: Partial<Request> = {}): Partial<Request> => ({
  body: {},
  params: {} as any,
  ...overrides,
});

const makeMockRes = (): Partial<Response> => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  res.send   = jest.fn().mockReturnValue(res);
  return res;
};

const makeMockNext = () => jest.fn();

// ─────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────

describe('UserController', () => {
  let mockService: jest.Mocked<IUserService>;
  let controller: UserController;

  beforeEach(() => {
    mockService = {
      register:   jest.fn(),
      getById:    jest.fn(),
      update:     jest.fn(),
      deactivate: jest.fn(),
      activate:   jest.fn(),
      delete:     jest.fn(),
    };

    controller = new UserController(mockService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ───────────────────────────────────────────
  // register()
  // ───────────────────────────────────────────

  describe('register()', () => {
    it('should call service and returns 201 with user', async () => {
      const body = { name: 'Gojo', email: 'gojo@test.com' };
      const user = makeUser();
      mockService.register.mockResolvedValue(user);

      const req  = makeMockReq({ body });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.register(req as Request, res as Response, next);

      expect(mockService.register).toHaveBeenCalledWith(body);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(user);
      expect(next).not.toHaveBeenCalled();
    });

    it('should forward known errors', async () => {
      const err = new UserError('Email exists', 'DUPLICATE_EMAIL', 409);
      mockService.register.mockRejectedValue(err);

      const req  = makeMockReq({ body: {} });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.register(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(err);
    });

    it('should forward unexpected errors', async () => {
      const err = new Error('Spanish Inquisition');
      mockService.register.mockRejectedValue(err);

      const req  = makeMockReq({ body: {} });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.register(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(err);
    });

 
    it('should not call res.json or res.send on error', async () => {
      mockService.register.mockRejectedValue(new Error('boom'));

      const req  = makeMockReq({ body: {} });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.register(req as Request, res as Response, next);

      expect(res.json).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should forward the exact error instance — not a wrapped copy', async () => {
      const original = new UserError('Email exists', 'DUPLICATE_EMAIL', 409);
      mockService.register.mockRejectedValue(original);

      const req  = makeMockReq({ body: {} });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.register(req as Request, res as Response, next);

      // next receives the exact same reference, not a re-wrapped error
      expect(next).toHaveBeenCalledWith(original);
      expect(next.mock.calls[0][0]).toBe(original);
    });
  });

  // ───────────────────────────────────────────
  // getById()
  // ───────────────────────────────────────────

  describe('getById()', () => {
    it('should call service and returns user', async () => {
      const user = makeUser();
      mockService.getById.mockResolvedValue(user);

      const req  = makeMockReq({ params: { id: 'userid-123' } as any });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.getById(req as Request<{ id: string }>, res as Response, next);

      expect(mockService.getById).toHaveBeenCalledWith('userid-123');
      expect(res.json).toHaveBeenCalledWith(user);
      expect(next).not.toHaveBeenCalled();
    });

    it('should forward errors', async () => {
      const err = new UserError('Not found', 'NOT_FOUND', 404);
      mockService.getById.mockRejectedValue(err);

      const req  = makeMockReq({ params: { id: 'ghost' } as any });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.getById(req as Request<{ id: string }>, res as Response, next);

      expect(next).toHaveBeenCalledWith(err);
    });

 
    it('should return 200 implicitly — no explicit status call', async () => {
      mockService.getById.mockResolvedValue(makeUser());

      const req  = makeMockReq({ params: { id: 'userid-123' } as any });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.getById(req as Request<{ id: string }>, res as Response, next);

      // res.json without res.status means 200 by default
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
    });

    it('should not call res.json or res.status on error', async () => {
      mockService.getById.mockRejectedValue(new UserError('Not found', 'NOT_FOUND', 404));

      const req  = makeMockReq({ params: { id: 'ghost' } as any });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.getById(req as Request<{ id: string }>, res as Response, next);

      expect(res.json).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────
  // update()
  // ───────────────────────────────────────────

  describe('update()', () => {
    it('should call service and returns updated user', async () => {
      const body    = { name: 'Updated' };
      const updated = makeUser(body);
      mockService.update.mockResolvedValue(updated);

      const req  = makeMockReq({ params: { id: 'userid-123' } as any, body });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.update(req as Request<{ id: string }>, res as Response, next);

      expect(mockService.update).toHaveBeenCalledWith('userid-123', body);
      expect(res.json).toHaveBeenCalledWith(updated);
      expect(next).not.toHaveBeenCalled();
    });

    it('should forward errors', async () => {
      const err = new UserError('Not found', 'NOT_FOUND', 404);
      mockService.update.mockRejectedValue(err);

      const req  = makeMockReq({ params: { id: 'ghost' } as any, body: {} });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.update(req as Request<{ id: string }>, res as Response, next);

      expect(next).toHaveBeenCalledWith(err);
    });

 
    it('should pass both id and body to service — not just one', async () => {
      const body = { name: 'New Name', timezone: 'America/New_York' };
      mockService.update.mockResolvedValue(makeUser(body));

      const req  = makeMockReq({ params: { id: 'userid-123' } as any, body });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.update(req as Request<{ id: string }>, res as Response, next);

      // Ensures controller doesn't accidentally swap or drop arguments
      expect(mockService.update).toHaveBeenCalledWith('userid-123', body);
    });

    it('should not call res.json or res.status on error', async () => {
      mockService.update.mockRejectedValue(new UserError('Not found', 'NOT_FOUND', 404));

      const req  = makeMockReq({ params: { id: 'ghost' } as any, body: {} });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.update(req as Request<{ id: string }>, res as Response, next);

      expect(res.json).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────
  // deactivate()
  // ───────────────────────────────────────────

  describe('deactivate()', () => {
    it('should call service and returns 204', async () => {
      mockService.deactivate.mockResolvedValue(undefined);

      const req  = makeMockReq({ params: { id: 'userid-123' } as any });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.deactivate(req as Request<{ id: string }>, res as Response, next);

      expect(mockService.deactivate).toHaveBeenCalledWith('userid-123');
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('should forward errors', async () => {
      const error = new UserError('User not found', 'NOT_FOUND', 404);
      mockService.deactivate.mockRejectedValue(error);

      const req  = makeMockReq({ params: { id: 'ghost-id' } as any });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.deactivate(req as Request<{ id: string }>, res as Response, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
    });

 
    it('should not call res.json on success', async () => {
      mockService.deactivate.mockResolvedValue(undefined);

      const req  = makeMockReq({ params: { id: 'userid-123' } as any });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.deactivate(req as Request<{ id: string }>, res as Response, next);

      expect(res.json).not.toHaveBeenCalled();
    });

    it('should not call res.send on error', async () => {
      mockService.deactivate.mockRejectedValue(
        new UserError('User not found', 'NOT_FOUND', 404)
      );

      const req  = makeMockReq({ params: { id: 'ghost-id' } as any });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.deactivate(req as Request<{ id: string }>, res as Response, next);

      expect(res.send).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────
  // activate()
  // ───────────────────────────────────────────

  describe('activate()', () => {
    it('should call service and returns 204', async () => {
      mockService.activate.mockResolvedValue(undefined);

      const req  = makeMockReq({ params: { id: 'userid-123' } as any });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.activate(req as Request<{ id: string }>, res as Response, next);

      expect(mockService.activate).toHaveBeenCalledWith('userid-123');
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('should forward errors', async () => {
      const error = new UserError('User not found', 'NOT_FOUND', 404);
      mockService.activate.mockRejectedValue(error);

      const req  = makeMockReq({ params: { id: 'ghost-id' } as any });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.activate(req as Request<{ id: string }>, res as Response, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
    });

 
    it('should not call res.json on success', async () => {
      mockService.activate.mockResolvedValue(undefined);

      const req  = makeMockReq({ params: { id: 'userid-123' } as any });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.activate(req as Request<{ id: string }>, res as Response, next);

      expect(res.json).not.toHaveBeenCalled();
    });

    it('should not call res.send on error', async () => {
      mockService.activate.mockRejectedValue(
        new UserError('User not found', 'NOT_FOUND', 404)
      );

      const req  = makeMockReq({ params: { id: 'ghost-id' } as any });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.activate(req as Request<{ id: string }>, res as Response, next);

      expect(res.send).not.toHaveBeenCalled();
    });

    it('should forward the exact error instance to next', async () => {
      const original = new UserError('User not found', 'NOT_FOUND', 404);
      mockService.activate.mockRejectedValue(original);

      const req  = makeMockReq({ params: { id: 'ghost-id' } as any });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.activate(req as Request<{ id: string }>, res as Response, next);

      expect(next.mock.calls[0][0]).toBe(original);
    });
  });

  // ───────────────────────────────────────────
  // delete()
  // ───────────────────────────────────────────

  describe('delete()', () => {
    it('should call service and returns 204', async () => {
      mockService.delete.mockResolvedValue(undefined);

      const req  = makeMockReq({ params: { id: 'userid-123' } as any });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.delete(req as Request<{ id: string }>, res as Response, next);

      expect(mockService.delete).toHaveBeenCalledWith('userid-123');
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('should forward errors', async () => {
      const error = new UserError('User not found', 'NOT_FOUND', 404);
      mockService.delete.mockRejectedValue(error);

      const req  = makeMockReq({ params: { id: 'ghost-id' } as any });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.delete(req as Request<{ id: string }>, res as Response, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
    });

 
    it('should not call res.json on success', async () => {
      mockService.delete.mockResolvedValue(undefined);

      const req  = makeMockReq({ params: { id: 'userid-123' } as any });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.delete(req as Request<{ id: string }>, res as Response, next);

      expect(res.json).not.toHaveBeenCalled();
    });

    it('should forward the exact error instance to next', async () => {
      const original = new UserError('User not found', 'NOT_FOUND', 404);
      mockService.delete.mockRejectedValue(original);

      const req  = makeMockReq({ params: { id: 'ghost-id' } as any });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.delete(req as Request<{ id: string }>, res as Response, next);

      expect(next.mock.calls[0][0]).toBe(original);
    });

    it('should forward unexpected non-UserError errors', async () => {
      const err = new Error('DB exploded');
      mockService.delete.mockRejectedValue(err);

      const req  = makeMockReq({ params: { id: 'userid-123' } as any });
      const res  = makeMockRes();
      const next = makeMockNext();

      await controller.delete(req as Request<{ id: string }>, res as Response, next);

      expect(next).toHaveBeenCalledWith(err);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});