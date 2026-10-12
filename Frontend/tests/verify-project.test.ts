// MOCKED: the decision logic of scripts/verify-project.mjs, driven by a fake fetch. No test contacts a real project.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

type Result = { status: string; check: string; message: string };
type Opts = { fetch?: typeof fetch; tables?: string[]; retired?: string[] };
const mod = "../scripts/verify-project.mjs";
const m = (await import(mod)) as {
  verify: (env: Record<string, string>, o?: Opts) => Promise<Result[]>;
  parseEnv: (t: string) => Record<string, string>;
  tablesFromSchema: (sql: string) => string[];
  fingerprint: (ref: string) => string;
  exitCode: (r: Result[]) => number;
  WARNING: string;
};

const REF = "abcdefghijklmnopqrst";
const SECRET_URL = `https://${REF}.supabase.co`;
const KEY = "sb_publishable_test";
const env = { NEXT_PUBLIC_SUPABASE_URL: SECRET_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: KEY };
const TABLES = ["items", "outfits", "chats", "chat_messages", "profile"];
const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const settings = { external: { email: true }, disable_signup: false };

type Handler = (url: string, init?: RequestInit) => Response | undefined;
/** A project that behaves like schema.secure.sql; `over` replaces individual answers. */
function project(over: { table?: Handler; list?: Handler; pub?: Handler; settings?: Handler } = {}, calls: { method: string; url: string }[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ method: init?.method ?? "GET", url });
    const pick = (h: Handler | undefined, fallback: Response) => h?.(url, init) ?? fallback;
    if (url.includes("/rest/v1/")) return pick(over.table, res(401, { code: "42501", message: "permission denied for table x" }));
    if (url.includes("/object/list/")) return pick(over.list, res(401, { message: "Unauthorized" }));
    if (url.includes("/object/public/")) return pick(over.pub, res(404, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" }));
    if (url.includes("/auth/v1/settings")) return pick(over.settings, res(200, settings));
    return res(404, {});
  }) as typeof fetch;
}
const run = (over = {}, calls: { method: string; url: string }[] = []) => m.verify(env, { fetch: project(over, calls), tables: TABLES });
const by = (out: Result[], check: string) => out.find((r) => r.check === check)!;

test("a correctly locked-down project: tables PASS, bucket privacy NOT VERIFIED, nothing FAIL, exit 2", async () => {
  const out = await run();
  for (const t of TABLES) assert.equal(by(out, `table ${t}`).status, "PASS", t);
  assert.equal(by(out, "reachable").status, "PASS");
  assert.equal(by(out, "photo listing").status, "PASS");
  assert.equal(by(out, "bucket privacy").status, "NOT VERIFIED", "private and missing look the same to the public key");
  assert.equal(m.exitCode(out), 2);
});

test("only GET requests and one storage listing are ever sent", async () => {
  const calls: { method: string; url: string }[] = [];
  await run({}, calls);
  assert.ok(calls.length > 0);
  assert.ok(calls.every((c) => c.method === "GET" || (c.method === "POST" && c.url.includes("/storage/v1/object/list/"))), JSON.stringify(calls.map((c) => c.method)));
  assert.ok(calls.every((c) => !/signup|token|logout|sign/i.test(c.url)), "no sign-in or sign-up endpoint is touched");
});

test("the old open schema FAILS; an empty-but-queryable table is NOT VERIFIED, never PASS", async () => {
  const withRows = await run({ table: () => res(200, [{ id: "x" }]) });
  for (const t of TABLES) assert.equal(by(withRows, `table ${t}`).status, "FAIL", t);
  assert.equal(m.exitCode(withRows), 1);
  const empty = await run({ table: () => res(200, []) });
  for (const t of TABLES) assert.equal(by(empty, `table ${t}`).status, "NOT VERIFIED", t);
});

test("missing tables FAIL; a bad-key refusal and odd errors are NOT VERIFIED rather than counted as security", async () => {
  assert.equal(by(await run({ table: () => res(404, { code: "PGRST205", message: "Could not find the table" }) }), "table items").status, "FAIL");
  assert.equal(by(await run({ table: () => res(401, { message: "Invalid API key" }) }), "table items").status, "NOT VERIFIED");
  assert.equal(by(await run({ table: () => res(500, { message: "boom" }) }), "table items").status, "NOT VERIFIED");
  assert.equal(by(await run({ table: () => res(403, { code: "42501", message: "x" }) }), "table items").status, "PASS");
});

test("a public bucket FAILS, whether it serves the probe or says object-not-found", async () => {
  assert.equal(by(await run({ pub: () => res(404, { statusCode: "404", error: "not_found", message: "Object not found" }) }), "bucket privacy").status, "FAIL");
  assert.equal(by(await run({ pub: () => res(200, {}) }), "bucket privacy").status, "FAIL");
  assert.equal(by(await run({ pub: () => res(502, {}) }), "bucket privacy").status, "NOT VERIFIED");
});

test("listable photos FAIL; an empty listing is NOT VERIFIED", async () => {
  assert.equal(by(await run({ list: () => res(200, [{ name: "a" }]) }), "photo listing").status, "FAIL");
  assert.equal(by(await run({ list: () => res(200, []) }), "photo listing").status, "NOT VERIFIED");
});

test("reachability: a dead project and a rejected key stop the run with FAIL", async () => {
  const dead = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
  const a = await m.verify(env, { fetch: dead, tables: TABLES });
  assert.equal(by(a, "reachable").status, "FAIL");
  assert.equal(a.filter((r) => r.check.startsWith("table")).length, 0, "no table checks after an unreachable project");
  const b = await run({ settings: () => res(401, { message: "Invalid API key" }) });
  assert.match(by(b, "reachable").message, /rejected the key/);
  assert.equal(b.filter((r) => r.check.startsWith("table")).length, 0);
});

test("email sign-in off or sign-ups closed FAIL", async () => {
  assert.equal(by(await run({ settings: () => res(200, { external: { email: false } }) }), "email sign-in").status, "FAIL");
  assert.equal(by(await run({ settings: () => res(200, { external: { email: true }, disable_signup: true }) }), "email sign-in").status, "FAIL");
});

test("it refuses BEFORE any request: retired project, secret key, non-anon JWT, bad URL, missing values, no tables", async () => {
  const never = (async () => { throw new Error("network must not be used"); }) as typeof fetch;
  const jwt = (role: string) => `x.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.y`;
  const cases: [Record<string, string>, Opts][] = [
    [env, { retired: [m.fingerprint(REF)] }],
    [{ ...env, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_abc" }, {}],
    [{ ...env, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("service_role") }, {}],
    [{ ...env, NEXT_PUBLIC_SUPABASE_URL: "https://example.com" }, {}],
    [{ ...env, NEXT_PUBLIC_SUPABASE_URL: "" }, {}],
    [{ ...env, NEXT_PUBLIC_SUPABASE_ANON_KEY: "" }, {}],
    [env, { tables: [] }],
  ];
  for (const [e, o] of cases) {
    const out = await m.verify(e, { fetch: never, tables: TABLES, ...o });
    assert.equal(out.length, 1, JSON.stringify(o));
    assert.equal(out[0].status, "FAIL");
    assert.match(out[0].message, /Nothing was contacted/);
  }
});

test("the retired project list lives in one shared module that all three consumers import", () => {
  const read = (f: string) => readFileSync(path.resolve(import.meta.dirname, f), "utf8");
  assert.match(read("../scripts/project-guard.mjs"), /RETIRED_PROJECTS = \["f8ffcfef"\]/);
  for (const f of ["../scripts/verify-project.mjs", "../scripts/check-env.mjs", "../build-env.ts"]) {
    assert.match(read(f), /project-guard\.mjs/, `${f} must use the shared guard`);
    assert.doesNotMatch(read(f), /f8ffcfef/, `${f} must not carry its own copy of the list`);
  }
});

test("output never contains the URL, the project id, or the key, even when answers contain them", async () => {
  const echo = { table: () => res(200, [{ leaked: SECRET_URL, key: KEY }]), list: () => res(200, [{ name: KEY }]), pub: () => res(200, { url: SECRET_URL }) };
  const text = JSON.stringify([...(await run(echo)), ...(await run())]);
  assert.ok(!text.includes(REF) && !text.includes(KEY) && !text.includes("supabase.co"));
});

test("tables come from schema.secure.sql, not a hardcoded list", () => {
  const sql = readFileSync(path.resolve(import.meta.dirname, "../../Backend/supabase/schema.secure.sql"), "utf8");
  assert.deepEqual(m.tablesFromSchema(sql).sort(), [...TABLES].sort());
  assert.deepEqual(m.tablesFromSchema("create table if not exists public.a (id int);\ncreate table if not exists public.b ();"), ["a", "b"]);
});

test("the report warns that this is not an ownership-isolation test; parseEnv handles comments and quotes", () => {
  assert.match(m.WARNING, /two separate accounts/);
  assert.deepEqual(m.parseEnv('# c\nA="x"\nB=y\n'), { A: "x", B: "y" });
});
