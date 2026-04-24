import { config } from '../../config/index.js';
import { DateTime } from 'luxon';

export function computeNextBirthdayAt(
  birthday: Date,
  timezone: string
): Date { 
  const now = DateTime.now().setZone(timezone);
 
  const birth = DateTime.fromJSDate(birthday).setZone(timezone);

  if (!birth.isValid) {
    throw new Error('Invalid birthday date');
  }
 
  let next = birth.set({
    year: now.year,
    hour: config.birthdayHour,
    minute: 0,
    second: 0,
    millisecond: 0,
  });

  // if already passed, move to next year
  if (next <= now) {
    next = next.plus({ years: 1 });
  }

  if (!next.isValid) {
    throw new Error('Invalid computed birthday');
  }
 
  return next.toUTC().toJSDate();
}