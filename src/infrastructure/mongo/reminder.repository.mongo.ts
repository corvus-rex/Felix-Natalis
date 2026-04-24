import mongoose, { Document, Schema } from 'mongoose';
import { IReminderRepository } from '../../modules/reminder/repository.js';

interface ReminderLogDocument extends Document {
  userId:   string;
  scheduledAt: Date;
}

const reminderLogSchema = new Schema<ReminderLogDocument>({
  userId:   { type: String, required: true },
  scheduledAt: { type: Date,   required: true },
});

reminderLogSchema.index({ userId: 1, scheduledAt: 1 }, { unique: true });

const ReminderLog = mongoose.model<ReminderLogDocument>('ReminderLog', reminderLogSchema);

export class ReminderRepositoryMongo implements IReminderRepository {
  async claimReminder(userId: string, scheduledAt: Date): Promise<boolean> {
    try {
      await ReminderLog.create({ userId, scheduledAt });
      return true;
    } catch (err: any) {
      if (err.code === 11000) return false;
      throw err;
    }
  }
}