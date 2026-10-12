// MOCKED: fake photos, a fake local reader and a fake AI with a fixed delay. Checks the batch engine behind "Detect colours":
// local-first, bounded parallelism, one shared rate-limit pause, abort, and a before/after timing comparison.
// Timings here are simulated (the "AI" is a timer), so they show the effect of the orchestration, not real provider latency.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { detectBatch, localIsConfident } from "../src/lib/detect-batch";
import { LlmError } from "../src/lib/llm";
import type { Dominant } from "../src/lib/imagecolor";

const clear = (c: string): Dominant => ({ colors: [c], shares: [0.9], separated: true });
const murky = (c: string): Dominant => ({ colors: [c, "grey"], shares: [0.4, 0.3], separated: false });
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `i${i}` }));
const photoOf = async (item: { id: string }) => new Blob([item.id]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const idOf = async (b: Blob) => await b.text();

describe("localIsConfident", () => {
  test("only a separable backdrop with one clearly dominant colour is trusted", () => {
    assert.equal(localIsConfident(clear("navy")), true);
    assert.equal(localIsConfident(murky("navy")), false);
    assert.equal(localIsConfident({ colors: ["navy"], shares: [0.5], separated: true }), false);
    assert.equal(localIsConfident({ colors: [], shares: [], separated: true }), false);
  });
});

describe("detectBatch (MOCKED photos and AI)", () => {
  const ctl = () => new AbortController();

  test("clear-cut photos never reach the AI; unclear ones do; every piece gets a result", async () => {
    const aiCalls: string[] = [];
    const r = await detectBatch(items(10), {
      loadPhoto: photoOf,
      local: async (b) => { const n = Number((await idOf(b)).slice(1)); return n % 2 ? murky("grey") : clear("navy"); },
      ai: async (b) => { aiCalls.push(await idOf(b)); return ["burgundy"]; },
      signal: ctl().signal,
    });
    assert.equal(aiCalls.length, 5);
    assert.equal(Object.keys(r).length, 10);
    assert.deepEqual(r.i0, { colors: ["navy"], source: "photo" });
    assert.deepEqual(r.i1, { colors: ["burgundy"], source: "ai" });
  });

  test("with no AI key the local read is used even when unclear, and an unreadable photo is an error, not a guess", async () => {
    const r = await detectBatch(items(2), { loadPhoto: photoOf, local: async (b) => ((await idOf(b)) === "i0" ? murky("tan") : { colors: [], shares: [], separated: false }), ai: null, signal: ctl().signal });
    assert.deepEqual(r.i0, { colors: ["tan", "grey"], source: "photo" });
    assert.ok("error" in r.i1);
  });

  test("at most `concurrency` AI calls are ever in flight", async () => {
    let live = 0;
    let peak = 0;
    await detectBatch(items(12), {
      loadPhoto: photoOf, local: async () => murky("grey"), concurrency: 3, signal: ctl().signal,
      ai: async () => { live++; peak = Math.max(peak, live); await sleep(10); live--; return ["red"]; },
    });
    assert.equal(peak, 3);
  });

  test("one rate-limit answer pauses every worker once, then work resumes and succeeds", async () => {
    let t = 0;
    const waits: number[] = [];
    let calls = 0;
    const r = await detectBatch(items(6), {
      loadPhoto: photoOf, local: async () => murky("grey"), concurrency: 3, signal: ctl().signal,
      now: () => t,
      sleep: async (ms) => { waits.push(ms); t += ms; },
      ai: async () => { calls++; if (calls <= 2) throw new LlmError("busy", "rate", 429, 8000); return ["green"]; },
    });
    assert.ok(Object.values(r).every((x) => "colors" in x && x.colors[0] === "green"), JSON.stringify(r));
    assert.ok(waits.length >= 1 && waits.every((w) => w >= 5000 && w <= 60_000), waits.join());
  });

  test("a long provider wait gives up on that piece (falling back to the local read) instead of freezing for minutes", async () => {
    const r = await detectBatch(items(1), {
      loadPhoto: photoOf, local: async () => murky("tan"), signal: ctl().signal,
      ai: async () => { throw new LlmError("daily limit", "rate", 429, 6 * 3600_000); },
    });
    assert.deepEqual(r.i0, { colors: ["tan", "grey"], source: "photo" });
  });

  test("an AI failure with no usable local read is reported per piece and the rest carry on", async () => {
    const r = await detectBatch(items(3), {
      loadPhoto: photoOf, local: async () => ({ colors: [], shares: [], separated: false }), signal: ctl().signal,
      ai: async (b) => { if ((await idOf(b)) === "i1") throw new Error("malformed"); return ["red"]; },
    });
    assert.ok("error" in r.i1 && "colors" in r.i0 && "colors" in r.i2);
  });

  test("Stop (abort) ends the run promptly, keeping what was done", async () => {
    const c = ctl();
    let calls = 0;
    const r = await detectBatch(items(50), {
      loadPhoto: photoOf, local: async () => murky("grey"), concurrency: 2, signal: c.signal,
      ai: async () => { await sleep(5); if (++calls === 3) c.abort(); return ["red"]; },
    });
    assert.ok(Object.keys(r).length < 50, "kept going after Stop");
    assert.ok(calls < 10, `${calls} calls after Stop`);
  });

  test("a photo that fails to load is that piece's error only", async () => {
    const r = await detectBatch(items(3), {
      loadPhoto: async (i) => { if (i.id === "i1") throw new Error("No photo"); return photoOf(i); },
      local: async () => clear("navy"), ai: null, signal: ctl().signal,
    });
    assert.deepEqual(r.i1, { error: "No photo" });
    assert.ok("colors" in r.i0 && "colors" in r.i2);
  });

  test("TIMING (simulated): 20 pieces, AI call = 150 ms. Before: every piece sequentially via AI. After: local-first + 3 workers", async () => {
    const AI_MS = 150;
    const N = 20;
    const local = async (b: Blob) => (Number((await idOf(b)).slice(1)) % 4 === 0 ? murky("grey") : clear("navy")); // 1 in 4 photos is unclear
    const ai = async () => { await sleep(AI_MS); return ["red"]; };

    const t0 = performance.now();
    for (const it of items(N)) { await photoOf(it); await ai(); } // the old loop
    const before = performance.now() - t0;

    let aiCalls = 0;
    const t1 = performance.now();
    await detectBatch(items(N), { loadPhoto: photoOf, local, ai: async () => (aiCalls++, ai()), signal: ctl().signal });
    const after = performance.now() - t1;

    console.log(`  [simulated] ${N} pieces: before ${(before / 1000).toFixed(2)} s (${N} AI calls, sequential) -> after ${(after / 1000).toFixed(2)} s (${aiCalls} AI calls, 3 workers): ${(before / after).toFixed(1)}x faster, ${N - aiCalls} calls saved`);
    assert.equal(aiCalls, 5);
    assert.ok(after < before / 4, `${after} vs ${before}`);
  });
});
