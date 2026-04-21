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
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
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
      register: jest.fn(),
      getById: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
      activate: jest.fn(),
      delete: jest.fn(),
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

      const req = makeMockReq({ body });
      const res = makeMockRes();
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

      const req = makeMockReq({ body: {} });
      const res = makeMockRes();
      const next = makeMockNext();

      await controller.register(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(err);
    });

    it('should forward unexpected errors', async () => {
      const err = new Error('Spanish Inquisiton');
      mockService.register.mockRejectedValue(err);

      const req = makeMockReq({ body: {} });
      const res = makeMockRes();
      const next = makeMockNext();

      await controller.register(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(err);
    });
  });

  // ───────────────────────────────────────────
  // getById()
  // ───────────────────────────────────────────

  describe('getById()', () => {
    it('should call service and returns user', async () => {
      const user = makeUser();
      mockService.getById.mockResolvedValue(user);

      const req = makeMockReq({ params: { id: 'userid-123' } as any });
      const res = makeMockRes();
      const next = makeMockNext();

      await controller.getById(req as Request<{ id: string }>, res as Response, next);

      expect(mockService.getById).toHaveBeenCalledWith('userid-123');
      expect(res.json).toHaveBeenCalledWith(user);
      expect(next).not.toHaveBeenCalled();
    });

    it('should forward errors', async () => {
      const err = new UserError('Not found', 'NOT_FOUND', 404);
      mockService.getById.mockRejectedValue(err);

      const req = makeMockReq({ params: { id: 'ghost' } as any });
      const res = makeMockRes();
      const next = makeMockNext();

      await controller.getById(req as Request<{ id: string }>, res as Response, next);

      expect(next).toHaveBeenCalledWith(err);
    });
  });

  // ───────────────────────────────────────────
  // update()
  // ───────────────────────────────────────────

  describe('update()', () => {
    it('should call service and returns updated user', async () => {
      const body = { name: 'Updated' };
      const updated = makeUser(body);
      mockService.update.mockResolvedValue(updated);

      const req = makeMockReq({ params: { id: 'userid-123' } as any, body });
      const res = makeMockRes();
      const next = makeMockNext();

      await controller.update(req as Request<{ id: string }>, res as Response, next);

      expect(mockService.update).toHaveBeenCalledWith('userid-123', body);
      expect(res.json).toHaveBeenCalledWith(updated);
      expect(next).not.toHaveBeenCalled();
    });

    it('should forward errors', async () => {
      const err = new UserError('Not found', 'NOT_FOUND', 404);
      mockService.update.mockRejectedValue(err);

      const req = makeMockReq({ params: { id: 'ghost' } as any, body: {} });
      const res = makeMockRes();
      const next = makeMockNext();

      await controller.update(req as Request<{ id: string }>, res as Response, next);

      expect(next).toHaveBeenCalledWith(err);
    });
  });

  // ───────────────────────────────────────────
  // deactivate()
  // ───────────────────────────────────────────

  describe('deactivate()', () => {
    it('should call service and returns 204', async () => {
      const req = makeMockReq({ params: { id: 'userid-123' } as any });
      const res = makeMockRes();
      const next = makeMockNext();
      mockService.deactivate.mockResolvedValue(undefined);

      await controller.deactivate(req as Request<{ id: string }>, res as Response, next);

      expect(mockService.deactivate).toHaveBeenCalledWith('userid-123');
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('should forward errors', async () => {
      const error = new UserError('User not found', 'NOT_FOUND', 404);
      const req = makeMockReq({ params: { id: 'ghost-id' } as any });
      const res = makeMockRes();
      const next = makeMockNext();
      mockService.deactivate.mockRejectedValue(error);

      await controller.deactivate(req as Request<{ id: string }>, res as Response, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────
  // activate()
  // ───────────────────────────────────────────

  describe('activate()', () => {
    it('should call service and returns 204', async () => {
      const req = makeMockReq({ params: { id: 'userid-123' } as any });
      const res = makeMockRes();
      const next = makeMockNext();
      mockService.activate.mockResolvedValue(undefined);

      await controller.activate(req as Request<{ id: string }>, res as Response, next);

      expect(mockService.activate).toHaveBeenCalledWith('userid-123');
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('should forward errors', async () => {
      const error = new UserError('User not found', 'NOT_FOUND', 404);
      const req = makeMockReq({ params: { id: 'ghost-id' } as any });
      const res = makeMockRes();
      const next = makeMockNext();
      mockService.activate.mockRejectedValue(error);

      await controller.activate(req as Request<{ id: string }>, res as Response, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────
  // delete()
  // ───────────────────────────────────────────

  describe('delete()', () => {
    it('should call service and returns 204', async () => {
      const req = makeMockReq({ params: { id: 'userid-123' } as any });
      const res = makeMockRes();
      const next = makeMockNext();
      mockService.delete.mockResolvedValue(undefined);

      await controller.delete(req as Request<{ id: string }>, res as Response, next);

      expect(mockService.delete).toHaveBeenCalledWith('userid-123');
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    }); 

    it('should forward errors', async () => {
      const error = new UserError('User not found', 'NOT_FOUND', 404);
      const req = makeMockReq({ params: { id: 'ghost-id' } as any });
      const res = makeMockRes();
      const next = makeMockNext();
      mockService.delete.mockRejectedValue(error);

      await controller.delete(req as Request<{ id: string }>, res as Response, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
    });
  });
});