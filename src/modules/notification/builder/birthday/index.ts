// notification/builder/birthday/index.ts

import { NotificationMessage } from '../../model.js';
import { buildEnglishBirthdayMessage } from './en.js';

export type Locale = 'en' | 'id';

export interface BirthdayMessageInput {
  recipientName: string;
  personName: string;
  isSelf?: boolean;
}

export function buildBirthdayMessage(locale: Locale, input: BirthdayMessageInput): NotificationMessage {
  switch (locale) {
    case 'en':
    default:
      return buildEnglishBirthdayMessage(input);
  }
}