// lib/age-eligibility.ts
//
// Youth sports eligibility: a single "age as of" cutoff date, chosen
// season-wide (seasons.age_cutoff_date), compared against each division's
// existing static age_min/age_max int range (0001_foundation.sql). Not a
// per-division exact birth-date range — see 0020_registration_and_household.sql.

/** Age in whole years as of `asOf`, computed the standard "birthday has/hasn't
 * happened yet this year" way. `dob` and `asOf` are both YYYY-MM-DD strings. */
export function calculateAge(dob: string, asOf: string): number {
  const dobDate = new Date(`${dob}T00:00:00Z`);
  const asOfDate = new Date(`${asOf}T00:00:00Z`);

  let age = asOfDate.getUTCFullYear() - dobDate.getUTCFullYear();
  const monthDiff = asOfDate.getUTCMonth() - dobDate.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && asOfDate.getUTCDate() < dobDate.getUTCDate())) {
    age--;
  }
  return age;
}

/** Whether a registrant is eligible for a division's age range.
 *
 * - A division with no age_min and no age_max has no age restriction —
 *   always eligible.
 * - A division WITH an age restriction but a registrant with no dob on
 *   file is treated as not-yet-eligible (we can't verify it) rather than
 *   silently allowing it through.
 * - ageCutoffDate falling back to "today" lets this function still work
 *   for a season that hasn't set one, though the admin UI should nudge
 *   toward setting it once age-restricted divisions exist. */
export function isEligibleForDivision(
  dob: string | null,
  ageCutoffDate: string | null,
  ageMin: number | null,
  ageMax: number | null
): boolean {
  if (ageMin == null && ageMax == null) return true;
  if (!dob) return false;

  const asOf = ageCutoffDate ?? new Date().toISOString().slice(0, 10);
  const age = calculateAge(dob, asOf);

  if (ageMin != null && age < ageMin) return false;
  if (ageMax != null && age > ageMax) return false;
  return true;
}
