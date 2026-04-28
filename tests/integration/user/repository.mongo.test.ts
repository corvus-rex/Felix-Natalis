import { UserRepositoryMongo } from '../../../src/infrastructure/mongo/user.repository.mongo';
import { startInfra, stopInfra, TestInfra } from '../setup/containers';
import mongoose from 'mongoose';

jest.setTimeout(30000);

describe('UserRepository (integration)', () => {
  let infra: TestInfra;
  let repo: UserRepositoryMongo;

  beforeAll(async () => {
    infra = await startInfra();
    repo = new UserRepositoryMongo();
  });

  afterAll(async () => {
    await stopInfra(infra);
    await mongoose.disconnect();
  });

  afterEach(async () => {
    await mongoose.connection.collection('users').deleteMany({});
  });

  const payload = {
    name: 'Gojo Satoru',
    email: 'gojo@jujutsu.com',
    birthday: new Date('1989-12-07'),
    timezone: 'Asia/Tokyo',
    nextBirthDayAt: new Date('2026-12-07T00:00:00.000Z'),
    active: true,
  };

  describe('create()', () => {
    it('should persist a user and return it with an id', async () => {
      const user = await repo.create(payload);

      expect(user.id).toBeDefined();
      expect(user.email).toBe(payload.email);
      expect(user.name).toBe(payload.name);
    });

    it('should preserve mapped date fields', async () => {
      const user = await repo.create(payload);

      expect(user.birthday.toISOString()).toBe('1989-12-07T00:00:00.000Z');
      expect(user.nextBirthDayAt.toISOString()).toBe(
        '2026-12-07T00:00:00.000Z'
      );
      expect(user.timezone).toBe('Asia/Tokyo');
    });

    it('should enforce unique email at the DB level', async () => {
      await repo.create(payload);

      await expect(repo.create(payload)).rejects.toMatchObject({
        code: 11000,
      });
    });
  });

  describe('findByEmail()', () => {
    it('should find an existing user by email', async () => {
      await repo.create(payload);

      const found = await repo.findByEmail(payload.email);

      expect(found).not.toBeNull();
      expect(found?.name).toBe(payload.name);
    });

    it('should return null for unknown email', async () => {
      const found = await repo.findByEmail('unknown@test.com');

      expect(found).toBeNull();
    });
  });

  describe('update()', () => {
    it('should update and return the updated document', async () => {
      const created = await repo.create(payload);

      const updated = await repo.update(created.id, {
        name: 'Gojo Updated',
      });

      expect(updated).not.toBeNull();
      expect(updated?.name).toBe('Gojo Updated');
    });

    it('should only update provided fields', async () => {
      const created = await repo.create(payload);

      const updated = await repo.update(created.id, {
        name: 'Only Name Changed',
      });

      expect(updated?.name).toBe('Only Name Changed');
      expect(updated?.email).toBe(payload.email);
      expect(updated?.timezone).toBe(payload.timezone);
      expect(updated?.active).toBe(true);
    });

    it('should return null for unknown id', async () => {
      const result = await repo.update(
        new mongoose.Types.ObjectId().toString(),
        { name: 'Sukuna' }
      );

      expect(result).toBeNull();
    });

    it('should reject invalid object id format', async () => {
      await expect(
        repo.update('invalid-object-id', { name: 'Bad Id' })
      ).rejects.toBeDefined();
    });

    it('should update active flag correctly', async () => {
      const created = await repo.create(payload);

      const updated = await repo.update(created.id, {
        active: false,
      });

      expect(updated?.active).toBe(false);
    });
  });
});