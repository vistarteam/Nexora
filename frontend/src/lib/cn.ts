/**
 * Join conditional class names.
 *
 * A 15-line local helper beats a dependency here, and it is the only styling
 * utility the components need.
 */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join(' ');
}
