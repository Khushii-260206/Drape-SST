// MOCKED: the vision model is replaced by canned replies (or a fake fetch). No real provider is contacted. This checks the
// prompt we send, how replies are validated against the catalogue, caching and call limits. It does not show that a real
// model recognises real photos correctly: that needs a real key (see the final report).
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { TYPES_BY_CATEGORY, categoryOfType, isKnownColor, isKnownType } from "../src/lib/catalog";

const rec = await import("../src/lib/recognize");
const llm = await import("../src/lib/llm");
const { PROVIDERS } = await import("../src/lib/providers");
const { coolDown } = await import("../src/lib/router");

const photo = (seed = "a") => new Blob([`photo-${seed}`], { type: "image/jpeg" });
const prepare = async () => "data:image/jpeg;base64,AAAA";
const reply = (o: Record<string, unknown>) => async () => ({ text: JSON.stringify(o), model: "mock-vision" });
const keys = [{ provider: "gemini" as const, apiKey: "MOCK", model: "m" }];
const run = (complete: NonNullable<Parameters<typeof rec.recognizePhoto>[1]["complete"]>, p = photo(), scope = "user-a") =>
  rec.recognizePhoto(p, { keys, scope, complete, prepare });

beforeEach(() => rec.clearRecognitionCache());

describe("top classification (MOCKED model replies)", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["T-shirt", { type: "tshirt", colors: ["white"], pattern: "solid", sleeve: "short", neckline: "crew", fit: "regular", confidence: "high" }, "tshirt"],
    ["polo shirt", { type: "polo", colors: ["navy"], sleeve: "short", neckline: "polo collar", confidence: "high" }, "polo"],
    ["tank top", { type: "tank", colors: ["black"], sleeve: "sleeveless", confidence: "high" }, "tank"],
    ["camisole", { type: "camisole", colors: ["blush"], sleeve: "sleeveless", material: "satin", confidence: "high" }, "camisole"],
    ["shirt", { type: "shirt", colors: ["light-blue"], pattern: "checked", sleeve: "long", neckline: "collared", confidence: "high" }, "shirt"],
    ["button-down", { type: "button-down", colors: ["white"], material: "linen-look", sleeve: "long", neckline: "collared", fit: "relaxed", confidence: "high" }, "button-down"],
    ["blouse", { type: "blouse", colors: ["cream"], sleeve: "three-quarter", confidence: "medium" }, "blouse"],
    ["tunic", { type: "tunic", colors: ["teal"], sleeve: "long", fit: "relaxed", confidence: "high" }, "tunic"],
    ["crop top", { type: "crop-top", colors: ["lilac"], fit: "cropped", confidence: "high" }, "crop-top"],
    ["bodysuit", { type: "bodysuit", colors: ["black"], sleeve: "long", fit: "fitted", confidence: "high" }, "bodysuit"],
    ["sweater", { type: "sweater", colors: ["camel"], material: "knit", sleeve: "long", neckline: "crew", confidence: "high" }, "sweater"],
    ["cardigan", { type: "cardigan", colors: ["sage"], material: "knit", sleeve: "long", confidence: "high" }, "cardigan"],
    ["sweatshirt", { type: "sweatshirt", colors: ["grey"], sleeve: "long", neckline: "crew", fit: "oversized", confidence: "high" }, "sweatshirt"],
    ["hoodie", { type: "hoodie", colors: ["charcoal"], sleeve: "long", neckline: "hooded", confidence: "high" }, "hoodie"],
  ];
  for (const [name, answer, expected] of cases) {
    test(`${name} stays a ${expected}, in the tops category, with its own display name`, async () => {
      const r = await run(reply(answer));
      assert.equal(r.type, expected);
      assert.equal(r.category, "top");
      assert.ok(r.colors.length >= 1 && r.colors.every(isKnownColor));
      assert.ok(r.name.toLowerCase().includes(rec.displayName({ type: expected, colors: [], pattern: undefined, material: undefined }).toLowerCase()), r.name);
    });
  }

  test("display name and category are separate: 'White linen-look button-down shirt' is category top, type button-down", async () => {
    const r = await run(reply(cases[5][1]));
    assert.equal(r.name, "White linen-look button-down shirt");
    assert.equal(r.type, "button-down");
    assert.match(r.details, /linen look/);
    assert.match(r.details, /long sleeves/);
    assert.match(r.details, /relaxed fit/);
  });

  test("an ambiguous hoodie/sweatshirt is flagged: not 'high', and the rival is offered", async () => {
    const r = await run(reply({ type: "sweatshirt", colors: ["grey"], confidence: "high", alternatives: ["hoodie", "sweater", "sweatshirt"] }));
    assert.equal(r.type, "sweatshirt");
    assert.notEqual(r.confidence, "high");
    assert.deepEqual(r.alternatives, ["hoodie", "sweater"]);
  });

  test("an ambiguous camisole/tank/blouse keeps the model's low confidence", async () => {
    const r = await run(reply({ type: "tank", colors: ["white"], confidence: "low", alternatives: ["camisole", "blouse"] }));
    assert.equal(r.confidence, "low");
    assert.deepEqual(r.alternatives, ["camisole", "blouse"]);
  });

  test("a vague 'top' answer is a real, editable type instead of an error", async () => {
    const r = await run(reply({ type: "top", colors: ["red"] }));
    assert.equal(r.type, "other-top");
    assert.equal(r.category, "top");
  });

  test("every top type, label and synonym a model might use lands on a catalogue id", () => {
    for (const t of TYPES_BY_CATEGORY.top) {
      assert.equal(rec.normalizeType(t.id), t.id);
      assert.equal(rec.normalizeType(t.label), t.id);
    }
    for (const [said, id] of [["Tee", "tshirt"], ["button down shirt", "button-down"], ["Tank Top", "tank"], ["cami", "camisole"], ["jumper", "sweater"], ["Polo Shirt", "polo"], ["crop top", "crop-top"]])
      assert.equal(rec.normalizeType(said), id, said);
  });

  test("the prompt lists every top id with a cue and every palette colour, and forbids guessing", () => {
    const p = rec.recognitionPrompt();
    for (const t of TYPES_BY_CATEGORY.top.filter((t) => t.id !== "other-top")) assert.ok(p.includes(`${t.id}:`), t.id);
    assert.match(p, /Only report what you can SEE/);
    assert.match(p, /never guess fabric blends/);
    assert.ok(p.includes("burgundy") && p.includes("rose-gold"));
  });
});

describe("validation: the model's words never reach the form unchecked", () => {
  test("unknown colours are dropped, known ones map to palette ids (labels and spellings accepted), at most two", async () => {
    const r = await run(reply({ type: "shirt", colors: ["Light Blue", "sparkle-teal", "gray", "navy"] }));
    assert.deepEqual(r.colors, ["light-blue", "grey"]);
  });

  test("invented attributes are dropped: no 100% cotton, no made-up fit, no sleeves on shoes", async () => {
    const r = await run(reply({ type: "tshirt", colors: ["white"], material: "100% organic cotton", fit: "super baggy", pattern: "paisley-ish", confidence: "high" }));
    assert.equal(r.material, undefined);
    assert.equal(r.fit, undefined);
    assert.equal(r.pattern, undefined);
    const shoe = await run(reply({ type: "sneakers", colors: ["white"], sleeve: "long", neckline: "crew" }), photo("shoe"));
    assert.equal(shoe.sleeve, undefined);
    assert.equal(shoe.neckline, undefined);
    assert.equal(shoe.category, "footwear");
  });

  test("a type that isn't in the catalogue is rejected, not stored", async () => {
    await assert.rejects(run(reply({ type: "spacesuit", colors: ["white"] })), rec.RecognitionError);
  });

  test("JSON inside a code fence, with chatter around it, is still read", async () => {
    const r = await run(async () => ({ text: 'Sure! Here you go:\n```json\n{"type":"hoodie","colors":["black"],"confidence":"high"}\n```\nHope that helps {really}.', model: "m" }));
    assert.equal(r.type, "hoodie");
  });

  test("malformed or empty replies fail with a clear error", async () => {
    await assert.rejects(run(async () => ({ text: "I can see a lovely shirt!", model: "m" })), rec.RecognitionError);
    await assert.rejects(run(async () => ({ text: '{"type": "shirt", "colors": [', model: "m" })), rec.RecognitionError);
  });

  test("every suggestion maps onto the stored schema: known type, matching category, known colours", async () => {
    for (const t of Object.values(TYPES_BY_CATEGORY).flat()) {
      const r = await run(reply({ type: t.id, colors: ["red", "off-white"] }), photo(t.id));
      assert.ok(isKnownType(r.type));
      assert.equal(r.category, categoryOfType(r.type));
      assert.ok(r.colors.every(isKnownColor));
    }
  });
});

describe("calls, caching and privacy", () => {
  const ok = '{"type":"tshirt","colors":["red"]}';
  test("the same photo is analysed once; the second ask is free", async () => {
    let calls = 0;
    const complete = async () => (calls++, { text: ok, model: "m" });
    await run(complete, photo("same"));
    await run(complete, photo("same"));
    assert.equal(calls, 1);
  });

  test("two overlapping asks for the same photo share one request", async () => {
    let calls = 0;
    const complete = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return { text: ok, model: "m" };
    };
    const [a, b] = await Promise.all([run(complete, photo("dup")), run(complete, photo("dup"))]);
    assert.equal(calls, 1);
    assert.equal(a, b);
  });

  test("a different photo, or a different ACCOUNT, is never served from someone else's cache", async () => {
    let calls = 0;
    const complete = async () => (calls++, { text: ok, model: "m" });
    await run(complete, photo("one"), "user-a");
    await run(complete, photo("two"), "user-a");
    await run(complete, photo("one"), "user-b");
    assert.equal(calls, 3);
  });

  test("clearing the cache (sign-out / account switch) forces a fresh request", async () => {
    let calls = 0;
    const complete = async () => (calls++, { text: ok, model: "m" });
    await run(complete, photo("c"));
    rec.clearRecognitionCache();
    await run(complete, photo("c"));
    assert.equal(calls, 2);
  });

  test("failures are not cached, so Retry really retries", async () => {
    let calls = 0;
    const complete = async () => {
      calls++;
      if (calls === 1) throw new llm.LlmError("busy", "rate", 429);
      return { text: ok, model: "m" };
    };
    await assert.rejects(run(complete, photo("r")), /busy/);
    assert.equal((await run(complete, photo("r"))).type, "tshirt");
    assert.equal(calls, 2);
  });

  test("with no vision-capable key nothing is sent and the message says what to do", async () => {
    const realFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => ((called = true), new Response("{}"))) as typeof fetch;
    try {
      await assert.rejects(rec.recognizePhoto(photo("nokey"), { keys: [{ provider: "groq", apiKey: "MOCK", model: "m" }], scope: "u", prepare }), /Gemini or OpenRouter key/);
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(called, false);
  });
});

describe("provider latency is bounded (MOCKED fetch)", () => {
  const realFetch = globalThis.fetch;
  let urls: string[] = [];
  beforeEach(() => {
    urls = [];
    for (const p of ["gemini", "groq", "openrouter"] as const) coolDown(p, "*", 0);
  });
  afterEach(() => { globalThis.fetch = realFetch; });
  const both = [
    { provider: "gemini" as const, apiKey: "MOCK-G", model: PROVIDERS.gemini.defaultModel },
    { provider: "openrouter" as const, apiKey: "MOCK-O", model: PROVIDERS.openrouter.defaultModel },
  ];
  const parts = [{ type: "text" as const, text: "hi" }];
  const okBody = () => new Response(JSON.stringify({ model: "m", choices: [{ message: { content: "{}" } }] }), { headers: { "content-type": "application/json" } });

  test("at most two attempts are made, even when every vision model fails", async () => {
    globalThis.fetch = (async (u: RequestInfo | URL) => (urls.push(String(u)), new Response(JSON.stringify({ error: { message: "down" } }), { status: 503, headers: { "content-type": "application/json" } }))) as typeof fetch;
    await assert.rejects(llm.completeVision(both, parts));
    assert.equal(urls.length, 2, `${urls.length} calls`);
  });

  test("a provider that never answers is abandoned after the lane timeout, then the next one answers", async () => {
    globalThis.fetch = ((u: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(u));
      if (String(u).includes("generativelanguage"))
        return new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
      return Promise.resolve(okBody());
    }) as typeof fetch;
    const t0 = performance.now();
    const r = await llm.completeVision(both, parts, { laneTimeoutMs: 3000 });
    const ms = performance.now() - t0;
    assert.equal(r.text, "{}");
    assert.equal(urls.length, 2);
    assert.ok(ms >= 2900 && ms < 4500, `${ms} ms`);
    console.log(`  [mocked] a silent first provider costs ${(ms / 1000).toFixed(1)} s with a 3 s lane timeout (default 20 s; was 45 s)`);
  });

  test("classification asks for low-temperature, bounded output", async () => {
    let body: Record<string, unknown> = {};
    globalThis.fetch = (async (_u: RequestInfo | URL, init?: RequestInit) => ((body = JSON.parse(String(init?.body))), okBody())) as typeof fetch;
    await llm.completeVision(both, parts, { temperature: 0.1, maxTokens: 700 });
    assert.equal(body.temperature, 0.1);
    assert.equal(body.max_tokens, 700);
  });
});
