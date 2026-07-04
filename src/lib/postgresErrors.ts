/** Postgres error code for unique constraint violations. Writes that are
 * idempotent by design (habit completions, activity events) treat it as a
 * harmless no-op instead of an error. */
export const UNIQUE_VIOLATION = '23505';
