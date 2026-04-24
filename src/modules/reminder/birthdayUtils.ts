import { DateTime } from 'luxon';

export function getNextBirthday(birthDate: Date): string {
  const now = DateTime.utc();
  const birth = DateTime.fromJSDate(birthDate).toUTC();

  let next = birth.set({ year: now.year }).startOf('day');

  if (next <= now) {
    next = next.plus({ years: 1 });
  }
  const iso = next.toISO();
  if (!iso) {
    throw new Error('Invalid DateTime in getNextBirthday');
  }
  return iso;
}