// ============================================================================
// Tests for OneMinCheckinClient and Mock API Interactions
// ============================================================================

import assert from "node:assert";
import http from "node:http";
import { OneMinCheckinClient } from "../src/checkin/client.js";

console.log("Running OneMinCheckinClient unit tests...");

// Setup a mock 1min.ai API server
let mockRequests: { url: string; method: string; headers: http.IncomingHttpHeaders; body: any }[] = [];
let mockMfaRequired = false;
let mockLoginFailuresRemaining = 0;
let initialBalance = 100_000;
let finalBalance = 115_000; // +15,000 daily checkin bonus

const mockServer = http.createServer(async (req, res) => {
  let bodyStr = "";
  for await (const chunk of req) {
    bodyStr += chunk;
  }
  let body: any = null;
  if (bodyStr) {
    try {
      body = JSON.parse(bodyStr);
    } catch {
      body = bodyStr;
    }
  }

  mockRequests.push({
    url: req.url || "",
    method: req.method || "",
    headers: req.headers,
    body,
  });

  // Verify custom frontend headers
  assert.ok(req.headers["mp-identity"], "Missing Mp-Identity header");
  assert.strictEqual(req.headers["origin"], "https://app.1min.ai");

  if (req.url === "/auth/login" && req.method === "POST") {
    if (mockLoginFailuresRemaining > 0) {
      mockLoginFailuresRemaining--;
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Internal server error" }));
      return;
    }

    if (body.email === "test@example.com" && body.password === "secret123") {
      if (mockMfaRequired) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            user: {
              uuid: "user-123",
              email: "test@example.com",
              mfaRequired: true,
              token: "mfa-temp-token-xyz",
            },
          }),
        );
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          token: "auth-token-123",
          user: {
            uuid: "user-123",
            email: "test@example.com",
            teams: [
              {
                teamId: "team-abc",
                userName: "tester",
                usedCredit: 5000,
                team: {
                  subscription: { userId: "user-123" },
                  credit: initialBalance,
                },
              },
            ],
          },
        }),
      );
      return;
    }

    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Invalid credentials" }));
    return;
  }

  if (req.url === "/auth/mfa/verify" && req.method === "POST") {
    assert.strictEqual(body.token, "mfa-temp-token-xyz");
    assert.ok(body.code, "Missing MFA code");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        token: "auth-token-mfa-456",
        user: {
          uuid: "user-123",
          email: "test@example.com",
          teams: [
            {
              teamId: "team-abc",
              userName: "tester",
              usedCredit: 5000,
              team: {
                subscription: { userId: "user-123" },
                credit: initialBalance,
              },
            },
          ],
        },
      }),
    );
    return;
  }

  if (req.url === "/notifications/unread" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ count: 1 }));
    return;
  }

  if (req.url?.startsWith("/teams/team-abc/credits") && req.method === "GET") {
    assert.strictEqual(req.headers["x-auth-token"]?.toString().startsWith("Bearer "), true);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ credit: finalBalance }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "Not found" }));
});

async function runTests() {
  await new Promise<void>((resolve) => {
    mockServer.listen(0, "127.0.0.1", () => resolve());
  });

  const address = mockServer.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // Test 1: Successful check-in flow with +15,000 credit bonus
    {
      mockRequests = [];
      mockMfaRequired = false;
      mockLoginFailuresRemaining = 0;

      const client = new OneMinCheckinClient({
        email: "test@example.com",
        password: "secret123",
        baseUrl,
      });

      const result = await client.execute();
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.userName, "tester");
      assert.strictEqual(result.initialCredit, 100_000);
      assert.strictEqual(result.finalCredit, 115_000);
      assert.strictEqual(result.creditDiff, 15_000);
      console.log("  ✓ Standard check-in with +15000 reward verified");
    }

    // Test 2: Successful check-in with TOTP MFA
    {
      mockRequests = [];
      mockMfaRequired = true;
      mockLoginFailuresRemaining = 0;

      const client = new OneMinCheckinClient({
        email: "test@example.com",
        password: "secret123",
        totpSecret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
        baseUrl,
      });

      const result = await client.execute();
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.userName, "tester");
      assert.strictEqual(result.finalCredit, 115_000);
      console.log("  ✓ 2FA / TOTP check-in flow verified");
    }

    // Test 3: Retry mechanism on transient network error
    {
      mockRequests = [];
      mockMfaRequired = false;
      mockLoginFailuresRemaining = 2; // Fail 2 times then succeed on 3rd attempt

      const client = new OneMinCheckinClient({
        email: "test@example.com",
        password: "secret123",
        baseUrl,
      });

      const result = await client.execute();
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.attemptCount, 3);
      console.log("  ✓ Retry on transient errors verified");
    }

    // Test 4: Missing credentials error
    {
      const client = new OneMinCheckinClient({});
      const result = await client.execute();
      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes("Missing check-in credentials"));
      console.log("  ✓ Missing credentials handling verified");
    }

    console.log("All OneMinCheckinClient tests passed successfully!\n");
  } finally {
    mockServer.close();
  }
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  mockServer.close();
  process.exit(1);
});
