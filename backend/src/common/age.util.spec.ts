import { ageRangeToBirthDateRange, computeAge } from './age.util';

describe('computeAge', () => {
  it('computes age when the birthday has already passed this year', () => {
    expect(computeAge(new Date('2000-01-01'), new Date('2026-06-01'))).toBe(26);
  });

  it('computes age when the birthday has not happened yet this year', () => {
    expect(computeAge(new Date('2000-12-31'), new Date('2026-06-01'))).toBe(25);
  });

  it('computes age exactly on the birthday', () => {
    expect(computeAge(new Date('2000-06-01'), new Date('2026-06-01'))).toBe(26);
  });
});

describe('ageRangeToBirthDateRange', () => {
  it('produces a range where a candidate born exactly minAge years ago qualifies', () => {
    const now = new Date('2026-06-01');
    const { earliestBirthDate, latestBirthDate } = ageRangeToBirthDateRange(
      18,
      30,
      now,
    );
    const bornExactlyMinAgeAgo = new Date('2008-06-01');
    expect(bornExactlyMinAgeAgo.getTime()).toBeLessThanOrEqual(
      latestBirthDate.getTime(),
    );
    expect(bornExactlyMinAgeAgo.getTime()).toBeGreaterThan(
      earliestBirthDate.getTime(),
    );
  });

  it('excludes someone one day too young', () => {
    const now = new Date('2026-06-01');
    const { latestBirthDate } = ageRangeToBirthDateRange(18, 30, now);
    const oneDayTooYoung = new Date('2008-06-02');
    expect(oneDayTooYoung.getTime()).toBeGreaterThan(latestBirthDate.getTime());
  });

  it('excludes someone one year too old', () => {
    const now = new Date('2026-06-01');
    const { earliestBirthDate } = ageRangeToBirthDateRange(18, 30, now);
    const oneYearTooOld = new Date('1995-06-01');
    expect(oneYearTooOld.getTime()).toBeLessThanOrEqual(
      earliestBirthDate.getTime(),
    );
  });
});
