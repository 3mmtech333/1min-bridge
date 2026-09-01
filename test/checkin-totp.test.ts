// ============================================================================
// Tests for RFC 6238 TOTP and Base32 Decoding
// ============================================================================

import assert from "node:assert";
import { base32Decode, generateTotp } from "../src/checkin/totp.js";

console.log("Running TOTP and Base32 unit tests...");

// 1. Base32 decoding tests
{
  const decoded1 = base32Decode("MZXW6YTBOI======").toString("utf-8");
  assert.strictEqual(decoded1, "foobar", "Base32 decoding failed for 'foobar'");

  // Test space/hyphen tolerance
  const decoded2 = base32Decode("MZXW-6YTB-OI").toString("utf-8");
  assert.strictEqual(decoded2, "foobar", "Base32 space/hyphen tolerance failed");

  console.log("  ✓ Base32 decode tests passed");
}

// 2. RFC 6238 Official Test Vectors
// Secret for SHA1: "12345678901234567890" (ASCII) -> Base32: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
{
  const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

  // Timestamp: 59s -> Time step: 1 -> Expected TOTP: 287082 (RFC 6238 Appendix B)
  const otp1 = generateTotp(rfcSecret, { timestamp: 59 * 1000, digits: 6, period: 30 });
  assert.strictEqual(otp1, "287082", `Expected 287082 at 59s, got ${otp1}`);

  // Timestamp: 1111111109s -> Expected TOTP: 081804
  const otp2 = generateTotp(rfcSecret, { timestamp: 1111111109 * 1000, digits: 6, period: 30 });
  assert.strictEqual(otp2, "081804", `Expected 081804 at 1111111109s, got ${otp2}`);

  // Timestamp: 1111111111s -> Expected TOTP: 050471
  const otp3 = generateTotp(rfcSecret, { timestamp: 1111111111 * 1000, digits: 6, period: 30 });
  assert.strictEqual(otp3, "050471", `Expected 050471 at 1111111111s, got ${otp3}`);

  // Timestamp: 1234567890s -> Expected TOTP: 005924
  const otp4 = generateTotp(rfcSecret, { timestamp: 1234567890 * 1000, digits: 6, period: 30 });
  assert.strictEqual(otp4, "005924", `Expected 005924 at 1234567890s, got ${otp4}`);

  // Timestamp: 2000000000s -> Expected TOTP: 279037
  const otp5 = generateTotp(rfcSecret, { timestamp: 2000000000 * 1000, digits: 6, period: 30 });
  assert.strictEqual(otp5, "279037", `Expected 279037 at 2000000000s, got ${otp5}`);

  console.log("  ✓ RFC 6238 TOTP test vectors passed");
}

console.log("All TOTP tests passed successfully!\n");
