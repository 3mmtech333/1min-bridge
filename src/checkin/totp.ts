// ============================================================================
// 1min-bridge — RFC 6238 TOTP Generator (Zero-Dependency)
// ============================================================================

import crypto from "node:crypto";

const RFC4648_BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Decodes a Base32-encoded string into a Buffer.
 * Ignores whitespace, hyphens, and padding characters.
 */
export function base32Decode(input: string): Buffer {
  const sanitized = input.toUpperCase().replace(/[\s\-=]/g, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (let i = 0; i < sanitized.length; i++) {
    const char = sanitized[i] ?? "";
    const index = RFC4648_BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid Base32 character: "${char}"`);
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

/**
 * Options for TOTP generation
 */
export interface TotpOptions {
  digits?: number; // default: 6
  period?: number; // default: 30 seconds
  algorithm?: "sha1" | "sha256" | "sha512"; // default: sha1
  timestamp?: number; // default: Date.now()
}

/**
 * Generates a standard RFC 6238 TOTP code.
 *
 * @param secret Base32-encoded secret key
 * @param options Generation options
 * @returns Formatted zero-padded TOTP string (e.g. "123456")
 */
export function generateTotp(secret: string, options: TotpOptions = {}): string {
  const digits = options.digits ?? 6;
  const period = options.period ?? 30;
  const algorithm = options.algorithm ?? "sha1";
  const timestamp = options.timestamp ?? Date.now();

  const keyBuffer = base32Decode(secret);

  // Time-step counter (8 bytes, Big-Endian)
  const counter = Math.floor(timestamp / 1000 / period);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter), 0);

  // HMAC calculation
  const hmac = crypto.createHmac(algorithm, keyBuffer);
  hmac.update(counterBuffer);
  const digest = hmac.digest();

  // Dynamic truncation
  const lastByte = digest[digest.length - 1] ?? 0;
  const offset = lastByte & 0x0f;
  const b0 = digest[offset] ?? 0;
  const b1 = digest[offset + 1] ?? 0;
  const b2 = digest[offset + 2] ?? 0;
  const b3 = digest[offset + 3] ?? 0;

  const binaryCode =
    ((b0 & 0x7f) << 24) |
    ((b1 & 0xff) << 16) |
    ((b2 & 0xff) << 8) |
    (b3 & 0xff);

  const mod = 10 ** digits;
  const otp = (binaryCode % mod).toString().padStart(digits, "0");

  return otp;
}
