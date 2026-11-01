/**
 * Runway labels in the weather data already carry the "RWY " prefix (e.g. "RWY 36").
 * Use this wherever a runway is printed after other text so it never reads "RWY RWY 36".
 */
export function formatRunway(runway: string): string {
  const r = (runway || '').trim();
  if (!r) return 'RWY';
  return /^RWY\b/i.test(r) ? r : `RWY ${r}`;
}
