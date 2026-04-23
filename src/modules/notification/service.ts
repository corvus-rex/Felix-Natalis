import { INotificationChannel, NotificationRecipient } from './model.js';
import { buildBirthdayMessage } from './builder/birthday/locale/index.js';
import { Locale } from './builder/birthday/locale/index.js';

export interface INotificationService {
  notifyBirthday( 
    recipient: NotificationRecipient,
    locale?: Locale, 
  ): Promise<void>;
}

export class NotificationService implements INotificationService {
  constructor(private readonly channels: INotificationChannel[]) {}

  async notifyBirthday(
    recipient: NotificationRecipient,
    locale?: Locale 
    ): Promise<void> { 
        const message = buildBirthdayMessage(locale ?? 'en', recipient);

        await Promise.all(
            this.channels.map((ch) => ch.send(recipient, message))
        );
    }
}