import crypto from "node:crypto";

/**
 * Alphabet for human-transcribed credentials.
 *
 * Excludes every glyph that is routinely misread when a password is copied off an email by
 * hand or read over the phone:
 *   - uppercase I, O      (look like 1 and 0)
 *   - lowercase l, o      (look like 1 and 0)
 *   - digits 1, 0         (look like l/I and O)
 *
 * The previous generator, `crypto.randomBytes(8).toString("base64url")`, drew from the full
 * base64url set and so produced exactly these characters. A real registration from that path
 * had to be recovered by brute-forcing 216 visually-ambiguous readings against the stored
 * hash, which is the cost this avoids.
 */
export const UNAMBIGUOUS_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZ" + "abcdefghijkmnpqrstuvwxyz" + "23456789";

/** Default length. 56^12 is ~1.1e21 combinations, well clear of practical guessing. */
export const TEMPORARY_PASSWORD_LENGTH = 12;

/**
 * Generate a temporary credential that a person can reliably re-type.
 *
 * - `crypto.randomInt` is used rather than `% alphabet.length` on random bytes, because the
 *   modulo of a byte range by a non-divisor biases the first characters of the alphabet.
 * - No symbols: they survive copy/paste but are the most common reason a hand-typed credential
 *   fails, and the value is already long enough to carry the entropy.
 * - The result stays far below bcrypt's 72-byte ceiling.
 */
export function generateTemporaryPassword(length = TEMPORARY_PASSWORD_LENGTH): string {
  if (!Number.isInteger(length) || length < 8) {
    throw new Error("Temporary credentials need at least 8 characters");
  }
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += UNAMBIGUOUS_ALPHABET[crypto.randomInt(UNAMBIGUOUS_ALPHABET.length)];
  }
  // Guarantee at least one letter and one digit so the value satisfies the common
  // letters-and-digits policy without retry loops at the call site.
  if (!/[A-Za-z]/.test(value) || !/[2-9]/.test(value)) {
    return generateTemporaryPassword(length);
  }
  return value;
}
