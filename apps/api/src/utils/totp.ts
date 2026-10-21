import { createHmac, timingSafeEqual } from 'node:crypto';

const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32(input: string): Buffer | null {
  const normalized = input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (!normalized || /[^A-Z2-7]/.test(normalized)) return null;

  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of normalized) {
    const value = ALPHABET.indexOf(character);
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function generateCode(secret: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(counterBuffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/**
 * Verifies a Google Authenticator-compatible RFC 6238 TOTP code.
 * A one-period clock-skew window accommodates small device/server drift without
 * accepting codes older than 30 seconds on either side.
 */
export function verifyTotpCode(secretValue: string | undefined, submittedCode: string, now = Date.now()): boolean {
  if (!secretValue || !/^\d{6}$/.test(submittedCode)) return false;
  const secret = decodeBase32(secretValue);
  if (!secret?.length) return false;

  const counter = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
  const submitted = Buffer.from(submittedCode);
  for (const offset of [-1, 0, 1]) {
    const expected = Buffer.from(generateCode(secret, counter + offset));
    if (timingSafeEqual(expected, submitted)) return true;
  }
  return false;
}
