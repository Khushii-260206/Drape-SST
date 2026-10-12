import assert from "node:assert/strict";
import { test } from "node:test";
import { getAiStatuses, healthLabel, keyFingerprint, recordOutcome, resetAiStatus, statusFor } from "../src/lib/aistatus";

// Pure-logic tests: no network. They prove how a status is derived, not that any real provider is reachable.

test("a saved or built-in key with no test is never called connected", () => {
  assert.equal(healthLabel(true, false, null).text, "Key saved — not tested");
  assert.equal(healthLabel(true, true, null).text, "Built-in key — not tested");
  assert.equal(healthLabel(false, false, null).text, "No key");
});

test("recorded outcomes map to states; an aborted request records nothing", () => {
  resetAiStatus();
  recordOutcome("groq", "k-1", { ok: true });
  recordOutcome("gemini", "k-2", { ok: false, kind: "rate", message: "busy" });
  recordOutcome("openrouter", "k-3", { ok: false, kind: "auth", message: "bad key" });
  recordOutcome("openrouter", "k-3", { ok: false, kind: "aborted", message: "stopped" });
  const all = getAiStatuses();
  assert.equal(all.groq?.health, "ok");
  assert.equal(all.gemini?.health, "rate");
  assert.equal(all.openrouter?.health, "auth"); // the abort did not overwrite it
  resetAiStatus();
  assert.deepEqual(getAiStatuses(), {});
});

test("nothing is sent until a test is explicitly run; then the real reply decides the state", async () => {
  const { testConnection } = await import("../src/lib/llm");
  resetAiStatus();
  const realFetch = globalThis.fetch;
  let calls = 0;
  let status = 200;
  globalThis.fetch = (async () => {
    calls++;
    return status === 200
      ? new Response(JSON.stringify({ model: "m", choices: [{ message: { content: "ready" } }] }), { status })
      : new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), { status });
  }) as typeof fetch;
  try {
    assert.equal(calls, 0, "importing / reading status must not call any provider");
    const cfg = { provider: "groq" as const, apiKey: "MOCK-KEY", model: "m" };
    assert.equal((await testConnection(cfg)).ok, true);
    assert.equal(calls, 1);
    assert.equal(getAiStatuses().groq?.health, "ok");
    status = 429;
    const r = await testConnection(cfg);
    assert.equal(r.ok, false);
    assert.equal(getAiStatuses().groq?.health, "rate");
    assert.ok(!JSON.stringify(getAiStatuses()).includes("MOCK-KEY"), "status must not hold the key");
  } finally {
    globalThis.fetch = realFetch;
    resetAiStatus();
  }
});

test("a status belongs to the key it was learned for; changing the key discards it", () => {
  const status = { health: "ok" as const, message: "", at: 0, fp: keyFingerprint("key-A") };
  assert.equal(statusFor({ groq: status }, "groq", "key-A"), status);
  assert.equal(statusFor({ groq: status }, "groq", "key-B"), null);
  assert.equal(statusFor({ groq: status }, "groq", undefined), null);
  assert.equal(statusFor({}, "groq", "key-A"), null);
});

test("labels distinguish success, rate limit, retired model, rejected key and failure", () => {
  const s = (health: "ok" | "rate" | "model" | "auth" | "network" | "failed") => ({ health, message: "", at: 0, fp: "" });
  assert.equal(healthLabel(true, false, s("ok")).text, "Connection successful");
  assert.equal(healthLabel(true, false, s("rate")).text, "Rate limited");
  assert.equal(healthLabel(true, false, s("model")).tone, "warn");
  assert.equal(healthLabel(true, false, s("auth")).text, "Key rejected");
  assert.equal(healthLabel(true, false, s("network")).text, "Connection failed");
  assert.equal(healthLabel(true, false, s("failed")).tone, "bad");
});

test("the fingerprint does not contain the key", () => {
  const fp = keyFingerprint("sk-SECRET-VALUE-123");
  assert.ok(!fp.includes("SECRET") && !fp.includes("sk-"));
});
