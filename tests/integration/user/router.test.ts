import supertest from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../../../src/app';
import { UserRepositoryMongo } from '../../../src/infrastructure/mongo/user.repository.mongo';
import { UserService } from '../../../src/modules/user/service';
import { UserController } from '../../../src/modules/user/controller';
import { startInfra, stopInfra, TestInfra } from '../setup/containers';

jest.setTimeout(30000);

 const mockQueue = {
  add: jest.fn(),
  removeBirthdayReminder: jest.fn().mockResolvedValue(undefined),
};

describe('User Routes (integration)', () => {
  let infra: TestInfra;
  let app:   ReturnType<typeof createApp>;

  beforeAll(async () => {
    infra = await startInfra();

    const repo    = new UserRepositoryMongo();
    const service = new UserService(repo, mockQueue as any);
    const ctrl    = new UserController(service);
    app           = createApp(ctrl);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await stopInfra(infra);
  });

  afterEach(async () => {
    await mongoose.connection.collection('users').deleteMany({});
    jest.clearAllMocks();
  });

  const validPayload = {
    name:     'Gojo Satoru',
    email:    'gojo@jujutsu.com',
    birthday:  new Date('1989-12-07'),
    timezone: 'Asia/Tokyo',
  };

  // ─── POST /api/v1/users/register ──────────────────────────────────────

  const registerEndpoint = '/api/v1/users/register';

  describe('POST /api/v1/users', () => {
    it('should create a user and return 201', async () => {
      const res = await supertest(app)
        .post(registerEndpoint)
        .send(validPayload);

      expect(res.status).toBe(201);
      expect(res.body.email).toBe('gojo@jujutsu.com');
      expect(res.body.id).toBeDefined();
    });

    it('should return 409 on duplicate email', async () => {
      await supertest(app).post(registerEndpoint).send(validPayload);
      const res = await supertest(app).post(registerEndpoint).send(validPayload);

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/email/i);
    });

    it('should return 400 on missing required fields', async () => {
      const res = await supertest(app)
        .post(registerEndpoint)
        .send({ name: 'Gojo' }); // missing email, birthday, timezone

      expect(res.status).toBe(400);
    });

    it('should return 400 on invalid timezone', async () => {
      const res = await supertest(app)
        .post(registerEndpoint)
        .send({ ...validPayload, timezone: 'Not/ATimezone' });

      expect(res.status).toBe(400);
    });

    it('should return 400 on invalid email format', async () => {
      const res = await supertest(app)
        .post(registerEndpoint)
        .send({ ...validPayload, email: 'not-an-email' });

      expect(res.status).toBe(400);
    });
  });

  // ─── GET /api/v1/users/:id ───────────────────────────────────

  describe('GET /api/v1/users/:id', () => {
    it('should return the user by id', async () => {
      const created = await supertest(app)
        .post(registerEndpoint)
        .send(validPayload);

      const res = await supertest(app)
        .get(`/api/v1/users/${created.body.id}`);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('gojo@jujutsu.com');
    });

    it('should return 404 for unknown id', async () => {
      const res = await supertest(app)
        .get(`/api/v1/users/${new mongoose.Types.ObjectId()}`);

      expect(res.status).toBe(404);
    });

    it('should return 400 for malformed id', async () => {
      const res = await supertest(app).get('/api/v1/users/not-an-id');
      expect(res.status).toBe(400);
    });
  });

  // ─── PATCH /api/v1/users/:id/deactivate ─────────────────────
  const deactivateEndpoint = (id: string) => `/api/v1/users/deactivate/${id}`;

  describe('PATCH /api/v1/users/deactivate/:id', () => {
    it('should deactivate user and return 204', async () => {
      const created = await supertest(app)
        .post(registerEndpoint)
        .send(validPayload);

      const res = await supertest(app)
        .patch(deactivateEndpoint(created.body.id));

      expect(res.status).toBe(204);
    });

    it('should persist deactivation — subsequent fetch shows active: false', async () => {
      const created = await supertest(app)
        .post(registerEndpoint)
        .send(validPayload);

      await supertest(app)
        .patch(deactivateEndpoint(created.body.id));

      const res = await supertest(app)
        .get(`/api/v1/users/${created.body.id}`);

      expect(res.body.active).toBe(false);
    });

    it('should call removeBirthdayReminder after deactivation', async () => {
      const created = await supertest(app)
        .post(registerEndpoint)
        .send(validPayload);

      await supertest(app)
        .patch(deactivateEndpoint(created.body.id));

      expect(mockQueue.removeBirthdayReminder).toHaveBeenCalledWith(
        created.body.id,
        expect.any(String)
      );
    });
  });
});