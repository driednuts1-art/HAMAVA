export function computeAge(birthDate: Date, now: Date = new Date()): number {
  let age = now.getFullYear() - birthDate.getFullYear();
  const hadBirthdayThisYear =
    now.getMonth() > birthDate.getMonth() ||
    (now.getMonth() === birthDate.getMonth() &&
      now.getDate() >= birthDate.getDate());
  if (!hadBirthdayThisYear) age--;
  return age;
}

/**
 * Converts an [minAge, maxAge] filter into the birthDate range that satisfies
 * it: `earliestBirthDate < birthDate <= latestBirthDate`.
 */
export function ageRangeToBirthDateRange(
  minAge: number,
  maxAge: number,
  now: Date = new Date(),
): { earliestBirthDate: Date; latestBirthDate: Date } {
  const latestBirthDate = new Date(now);
  latestBirthDate.setFullYear(now.getFullYear() - minAge);

  const earliestBirthDate = new Date(now);
  earliestBirthDate.setFullYear(now.getFullYear() - maxAge - 1);

  return { earliestBirthDate, latestBirthDate };
}
