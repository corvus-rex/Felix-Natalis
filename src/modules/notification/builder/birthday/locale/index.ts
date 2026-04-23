import { NotificationMessage, NotificationRecipient } from '../../../model.js';
import { buildEnglishBirthdayMessage } from './en.js';

export type Locale = 'en' | 'id';
 
export function buildBirthdayMessage(locale: Locale, recipient: NotificationRecipient): NotificationMessage {
  switch (locale) {
    case 'en':
    default:
      return buildEnglishBirthdayMessage(recipient);
  }
}

export function resolveLocaleFromTimezone(timezone: string): Locale {
  if (timezone === 'Asia/Jakarta') {
    return 'id';
  }

  return 'en';
}