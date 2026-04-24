import { DateTime } from 'luxon';
import { config } from '../../config/index.js';

export function getNextBirthday(
  birthDate: Date,
  timezone: string
): string {
  const now = DateTime.now().setZone(timezone);

  const birth = DateTime.fromJSDate(birthDate).setZone(timezone);

  // set this year's birthday at xx:00 local time
  // x equal to config value (e.g. 9 for 9:00 AM)
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

  const iso = next.toUTC().toISO();
  if (!iso) throw new Error('Invalid DateTime in getNextBirthday');

  return iso;
}