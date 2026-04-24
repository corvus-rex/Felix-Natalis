import { ReminderRepositoryMongo } from '../../../src/infrastructure/mongo/reminder.repository';
import { startInfra, stopInfra, TestInfra } from '../setup/containers';
import mongoose from 'mongoose';

jest.setTimeout(30000);

describe('ReminderRepository (integration)', () => {
  let infra: TestInfra;
  let repo:  ReminderRepositoryMongo;

  beforeAll(async () => {
    infra = await startInfra();
    repo  = new ReminderRepositoryMongo();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await stopInfra(infra);
  });

  afterEach(async () => {
    await mongoose.connection.collection('reminderlogs').deleteMany({});
  });

  const userId      = 'userid-123';
  const scheduledAt = new Date('2026-12-07T00:00:00.000Z');

  describe('claimReminder()', () => {
    it('should return true on first claim', async () => {
      const claimed = await repo.claimReminder(userId, scheduledAt);
      expect(claimed).toBe(true);
    });

    it('should return false on duplicate claim — same user and time', async () => {
      await repo.claimReminder(userId, scheduledAt);
      const second = await repo.claimReminder(userId, scheduledAt);

      expect(second).toBe(false);
    });

    it('should allow same user to claim a different scheduledAt', async () => {
      await repo.claimReminder(userId, scheduledAt);

      const nextYear = new Date('2027-12-07T00:00:00.000Z');
      const claimed  = await repo.claimReminder(userId, nextYear);

      expect(claimed).toBe(true);
    });

    it('should allow different users to claim the same scheduledAt', async () => {
      await repo.claimReminder('user-A', scheduledAt);
      const claimed = await repo.claimReminder('user-B', scheduledAt);

      expect(claimed).toBe(true);
    });

    it('should handle concurrent claims — only one succeeds', async () => {
      // Simulate two workers racing on the same job
      const [first, second] = await Promise.all([
        repo.claimReminder(userId, scheduledAt),
        repo.claimReminder(userId, scheduledAt),
      ]);

      const results = [first, second];
      expect(results.filter(Boolean)).toHaveLength(1);  // exactly one true
      expect(results.filter(r => !r)).toHaveLength(1);  // exactly one false
    });
  });
});