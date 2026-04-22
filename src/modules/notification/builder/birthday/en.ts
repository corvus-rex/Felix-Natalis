// en.ts

import { NotificationMessage } from '../../model.js';
import { BirthdayMessageInput } from './index.js';

export function buildEnglishBirthdayMessage(
  input: BirthdayMessageInput
): NotificationMessage {
  const isSelf =
    input.isSelf ?? input.recipientName === input.personName;

  if (isSelf) {
    return {
      subject: '🎉 Happy Birthday!',
      body: `Hi ${input.recipientName},

        Today is your birthday!

        Wishing you a wonderful day and a fantastic year ahead!

        Cheers,
        Felix Natalis Team`,
    };
  }

  return {
    subject: '🎉 Birthday Reminder',
    body: `Hi ${input.recipientName},

        Today is ${input.personName}'s birthday.

        Don’t forget to send your wishes! 🎂`,
  };
}