// MOCKED: the three AI providers are replaced by a fake fetch that speaks their wire format. No real key is used and no
// request leaves the machine. This verifies the app's request building, streaming, error handling and failover; it does
// NOT prove that a real Gemini / Groq / OpenRouter key works (see the manual checklist).
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

const llm = await import("../src/lib/llm");
const { PROVIDERS } = await import("../src/lib/providers");
const { coolDown } = await import("../src/lib/router");

type Handler = (req: { url: string; auth: string; body: Record<string, unknown> }) => Response;
const realFetch = globalThis.fetch;
let calls: { url: string; auth: string; body: Record<string, unknown> }[] = [];
let handler: Handler;

const sse = (...chunks: string[]) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify({ model: "m-x", choices: [{ delta: { content: c } }] })}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  });
const err = (status: number, message: string) => new Response(JSON.stringify({ error: { message } }), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  calls = [];
  for (const p of ["gemini", "groq", "openrouter"] as const) coolDown(p, "*", 0);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const req = { url, auth: new Headers(init?.headers).get("authorization") ?? "", body: JSON.parse(String(init?.body ?? "{}")) };
    calls.push(req);
    return handler(req);
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

const key = (provider: "gemini" | "groq" | "openrouter") => ({ provider, apiKey: `MOCK-KEY-${provider}`, model: PROVIDERS[provider].defaultModel });
async function collect(gen: AsyncGenerator<{ type: string; text?: string; model?: string }>) {
  let text = "";
  for await (const e of gen) if (e.type === "content") text += e.text;
  return text;
}
const msgs = [{ role: "user" as const, content: "hi" }];

describe("each provider, mocked", () => {
  for (const provider of ["gemini", "groq", "openrouter"] as const) {
    test(`${provider}: streams a reply to the right endpoint with only its own key`, async () => {
      handler = () => sse("Wear ", "the navy shirt.");
      const text = await collect(llm.streamChatAny([key(provider)], msgs));
      assert.equal(text, "Wear the navy shirt.");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, PROVIDERS[provider].endpoint);
      assert.equal(calls[0].auth, `Bearer MOCK-KEY-${provider}`);
      assert.equal(calls[0].body.stream, true);
    });

    test(`${provider}: testConnection reports success`, async () => {
      handler = () => new Response(JSON.stringify({ model: "m-x", choices: [{ message: { content: "ready" } }] }), { headers: { "content-type": "application/json" } });
      const r = await llm.testConnection(key(provider));
      assert.equal(r.ok, true);
      assert.match(r.message, /Connected/);
    });

    test(`${provider}: a rejected key is reported as an auth problem`, async () => {
      handler = () => err(401, "bad key");
      const r = await llm.testConnection(key(provider));
      assert.equal(r.ok, false);
      assert.equal(r.kind, "auth");
      assert.match(r.message, new RegExp(PROVIDERS[provider].name));
    });
  }

  test("openrouter also sends fallback models", async () => {
    handler = () => sse("ok");
    await collect(llm.streamChatAny([key("openrouter")], msgs));
    const models = calls[0].body.models;
    assert.ok(Array.isArray(models) && models.length >= 2);
  });

  test("a key with an invisible character is rejected before any request is made", async () => {
    handler = () => sse("never");
    await assert.rejects(collect(llm.streamChatAny([{ ...key("groq"), apiKey: "abc​def" }], msgs)), /contains a character/);
    assert.equal(calls.length, 0);
  });

  test("no keys at all gives a clear message", async () => {
    await assert.rejects(collect(llm.streamChatAny([], msgs)), /Add an API key in Settings/);
  });
});

describe("failover between providers, mocked", () => {
  test("rate-limited provider -> next provider answers, and the user sees one clean reply", async () => {
    handler = (r) => (r.url.includes("groq") ? err(429, "slow down") : sse("from other"));
    const text = await collect(llm.streamChatAny([key("groq"), key("openrouter")], msgs));
    assert.equal(text, "from other");
  });

  test("bad key on one provider never leaks to another", async () => {
    handler = (r) => (r.url.includes("generativelanguage") ? err(400, "API key not valid") : sse("fine"));
    const text = await collect(llm.streamChatAny([key("gemini"), key("groq")], msgs));
    assert.equal(text, "fine");
    for (const c of calls) {
      const owner = c.url.includes("generativelanguage") ? "gemini" : c.url.includes("groq") ? "groq" : "openrouter";
      assert.equal(c.auth, `Bearer MOCK-KEY-${owner}`);
    }
  });

  test("everyone down -> one readable error", async () => {
    handler = () => err(429, "busy");
    await assert.rejects(collect(llm.streamChatAny([key("groq"), key("openrouter")], msgs)), /Every AI provider is busy/);
  });
});

describe("photo colour detection (vision), mocked", () => {
  test("groq has no vision model, so a groq-only setup explains what to add", async () => {
    await assert.rejects(llm.completeVision([key("groq")], [{ type: "text", text: "colours?" }]), /Gemini or OpenRouter key/);
  });
  test("gemini answers", async () => {
    handler = () => new Response(JSON.stringify({ model: "g", choices: [{ message: { content: "navy" } }] }), { headers: { "content-type": "application/json" } });
    const r = await llm.completeVision([key("gemini")], [{ type: "text", text: "colours?" }]);
    assert.equal(r.text, "navy");
  });
});
