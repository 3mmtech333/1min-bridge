// ============================================================================
// Tests for Checkin Endpoints (/v1/checkin/status and /v1/checkin/run)
// ============================================================================

import assert from "node:assert";
import app from "../src/index.js";

console.log("Running Checkin API routes integration tests...");

async function runRouteTests() {
  // Test 1: GET /v1/checkin/status
  {
    const res = await app.request("/v1/checkin/status", {
      method: "GET",
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(typeof body.enabled, "boolean");
    assert.strictEqual(typeof body.totalCheckins, "number");
    assert.ok(Array.isArray(body.history));
    console.log("  ✓ GET /v1/checkin/status returned valid schema");
  }

  // Test 2: GET /api/checkin/status alias
  {
    const res = await app.request("/api/checkin/status", {
      method: "GET",
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(typeof body.enabled, "boolean");
    console.log("  ✓ GET /api/checkin/status alias works");
  }

  // Test 3: POST /v1/checkin/run when unconfigured
  {
    const res = await app.request("/v1/checkin/run", {
      method: "POST",
    });

    // Since no email/pwd configured in default test env, returns 500 with descriptive payload
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.ok(body.result);
    console.log("  ✓ POST /v1/checkin/run gracefully handled unconfigured state");
  }

  console.log("All Checkin API route tests passed successfully!\n");
}

runRouteTests().catch((err) => {
  console.error("Route test failed:", err);
  process.exit(1);
});
