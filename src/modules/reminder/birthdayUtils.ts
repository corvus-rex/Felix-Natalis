import { config } from '../../config/index.js';
import { DateTime } from 'luxon';

export function computeNextBirthdayAt(
  birthday: Date | string,
  timezone: string
): Date {
  const now = DateTime.now().setZone(timezone);

  const birth = birthday instanceof Date
    ? DateTime.fromJSDate(birthday).setZone(timezone)
    : DateTime.fromISO(birthday as string).setZone(timezone);

  if (!birth.isValid) {
    throw new Error('Invalid birthday date',);
  }

  const isLeapDay = birth.month === 2 && birth.day === 29;

  // Attempt to set the birthday in the current year.
  // For Feb 29 in a non-leap year, fall back to Feb 28.
  const resolveForYear = (year: number): DateTime => {
    if (isLeapDay && !isLeapYear(year)) {
      // Feb 28 in non-leap years — closest valid date before the real birthday
      return DateTime.fromObject(
        { year, month: 2, day: 28, hour: config.birthdayHour, minute: 0, second: 0, millisecond: 0 },
        { zone: timezone }
      );
    }
    return birth.set({
      year,
      hour: config.birthdayHour,
      minute: 0,
      second: 0,
      millisecond: 0,
    });
  };

  let next = resolveForYear(now.year);

  // If already passed this year, try next year
  if (next <= now) {
    next = resolveForYear(now.year + 1);
  }

  if (!next.isValid) {
    throw new Error('Invalid computed birthday');
  }

  return next.toUTC().toJSDate();
}

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;