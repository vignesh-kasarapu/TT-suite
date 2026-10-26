/** Joins class names; CSS-module lookups are `string | undefined` under noUncheckedIndexedAccess. */
export function cx(...parts: (string | undefined | false | null)[]): string {
  return parts.filter(Boolean).join(' ');
}
