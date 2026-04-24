export interface IReminderRepository {
  claimReminder(userId: string, scheduledAt: Date): Promise<boolean>;
}