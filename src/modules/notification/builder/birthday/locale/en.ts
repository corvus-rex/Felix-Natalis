import { NotificationMessage, NotificationRecipient } from '../../../model.js';

export function buildEnglishBirthdayMessage(recipient: NotificationRecipient): NotificationMessage {

  return {
    subject: '🎉 Happy Birthday!',
    body: `Hi ${recipient.name},

      Today is your birthday!

      Wishing you a wonderful day and a fantastic year ahead!

      Cheers,
      Felix Natalis Team`,
  };
}