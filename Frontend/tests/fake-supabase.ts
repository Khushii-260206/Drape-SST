/*
 * MOCK. An in-memory stand-in for Supabase's REST (PostgREST) and Storage HTTP APIs, installed over global fetch.
 * Nothing here talks to a network or to any real Supabase project. It supports only what Drape's data layer uses,
 * and can simulate the setup mistakes we want clear errors for (missing bucket, missing policy, missing table).
 * It also stands in for Supabase Auth (email + password) and imitates the owner-only policies of schema.secure.sql:
 * a request without a valid token is refused, and a user only ever sees, writes or deletes rows and photos of their own.
 * That imitation is a model of the policies, not proof that the real database enforces them (Backend/supabase/tests does that).
 */

import { deleteAccount as runDeletion, DeletionError, isFresh, type Admin } from "../../Backend/supabase/functions/delete-account/core";

type Row = Record<string, unknown>;
export type Faults = {
  storage?: "no-bucket" | "rls" | "too-large" | "bad-mime" | "delete-fails";
  missingTable?: string;
  badKey?: boolean;
  emailRateLimit?: boolean; // sign-up answers 429 over_email_send_rate_limit, like the built-in mailer after a few mails
  confirmEmail?: boolean; // sign-up returns no session until the address is confirmed
  logout?: "network" | "server-error"; // the sign-out request fails
  deleteAccount?: "not-deployed" | "network" | "storage" | "data" | "user" | "stale-token"; // the delete-account function misbehaves
};

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub: string, iat = Math.floor(Date.now() / 1000)) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, role: "authenticated", iat, exp: iat + 3600 })}.sig`;
const subOf = (headers: Headers): string | undefined => {
  const token = /^Bearer (.+)$/.exec(headers.get("authorization") ?? "")?.[1];
  try {
    const p = JSON.parse(Buffer.from(token?.split(".")[1] ?? "", "base64url").toString());
    return p.role === "authenticated" && p.exp * 1000 > Date.now() ? p.sub : undefined;
  } catch {
    return undefined;
  }
};

export class FakeSupabase {
  tables: Record<string, Row[]> = { items: [], outfits: [], chats: [], chat_messages: [], profile: [] };
  objects = new Map<string, number>(); // path -> byte size
  faults: Faults = {};
  log: string[] = [];
  private signCount = 0; // every signed link is distinct, like a real one (its token carries an expiry)
  users = new Map<string, { id: string; password: string }>(); // email -> account
  private realFetch = globalThis.fetch;

  install() {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => this.handle(input, init)) as typeof fetch;
  }
  uninstall() {
    globalThis.fetch = this.realFetch;
  }

  private json(status: number, body: unknown, headers: Record<string, string> = {}) {
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  }

  private async handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (typeof input === "string" && input.startsWith("data:")) return this.realFetch(input); // a data: URL never touches a network
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname !== "mock-project.invalid") throw new TypeError(`MOCK: unexpected network call to ${url.hostname}`);
    const method = (init?.method ?? "GET").toUpperCase();
    this.log.push(`${method} ${url.pathname}${/\/(logout|signup)$/.test(url.pathname) ? url.search : ""}`);
    if (this.faults.badKey) return this.json(401, { message: "Invalid API key", hint: "Double check your Supabase `anon` or `service_role` API key." });
    if (url.pathname.startsWith("/auth/v1/")) return this.auth(url, method, init);
    if (url.pathname === "/functions/v1/delete-account") return this.deleteAccountFunction(method, init);
    // A signed photo link carries its permission in the ?token=, not in a header: serve the bytes if the object exists.
    if (method === "GET" && url.pathname.startsWith("/storage/v1/object/sign/wardrobe/") && url.searchParams.get("token")?.startsWith("mock-")) {
      const path = decodeURIComponent(url.pathname.replace("/storage/v1/object/sign/wardrobe/", ""));
      return this.objects.has(path) ? new Response(photo(), { status: 200, headers: { "content-type": "image/png" } }) : this.json(404, { error: "not_found" });
    }
    // Like the secure schema: anon has no access at all, so no valid user token means no data and no photos.
    const uid = subOf(new Headers(init?.headers));
    if (!uid) return this.json(401, { code: "42501", message: "permission denied for table (no signed-in user)", statusCode: "401", error: "Unauthorized" });
    if (url.pathname.startsWith("/rest/v1/")) return this.rest(url, method, uid, init);
    if (url.pathname.startsWith("/storage/v1/")) return this.storage(url, method, uid, init);
    return this.json(404, { message: "not found" });
  }

  // ---------------------------------------------------------------- Auth subset
  private auth(url: URL, method: string, init?: RequestInit): Response {
    const body = init?.body ? (JSON.parse(String(init.body)) as { email?: string; password?: string; refresh_token?: string }) : {};
    const session = (id: string, email: string) => ({
      access_token: jwt(id), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: `refresh-${id}`, user: { id, aud: "authenticated", role: "authenticated", email, identities: [{ id }] },
    });
    if (url.pathname === "/auth/v1/signup" && method === "POST") {
      if (this.faults.emailRateLimit) return this.json(429, { code: 429, error_code: "over_email_send_rate_limit", msg: "email rate limit exceeded" });
      const email = String(body.email).toLowerCase();
      if (this.users.has(email)) return this.json(200, { id: "x", aud: "authenticated", email, identities: [] }); // Supabase hides duplicates
      if (String(body.password).length < 6) return this.json(422, { code: 422, error_code: "weak_password", msg: "Password should be at least 6 characters." });
      const id = crypto.randomUUID();
      this.users.set(email, { id, password: String(body.password) });
      return this.json(200, this.faults.confirmEmail ? { id, aud: "authenticated", email, identities: [{ id }] } : session(id, email));
    }
    if (url.pathname === "/auth/v1/token" && method === "POST") {
      if (url.searchParams.get("grant_type") === "refresh_token") {
        const entry = [...this.users].find(([, u]) => `refresh-${u.id}` === body.refresh_token);
        return entry ? this.json(200, session(entry[1].id, entry[0])) : this.json(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
      }
      const u = this.users.get(String(body.email).toLowerCase());
      if (!u || u.password !== body.password) return this.json(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      return this.json(200, session(u.id, String(body.email).toLowerCase()));
    }
    if (url.pathname === "/auth/v1/recover" && method === "POST") {
      if (this.faults.emailRateLimit) return this.json(429, { code: 429, error_code: "over_email_send_rate_limit", msg: "email rate limit exceeded" });
      return this.json(200, {}); // same answer whether or not the address exists
    }
    if (url.pathname === "/auth/v1/user") {
      const uid = subOf(new Headers(init?.headers));
      const entry = [...this.users].find(([, u]) => u.id === uid);
      if (!uid || !entry) return this.json(401, { code: 401, error_code: "session_not_found", msg: "Auth session missing!" });
      if (method === "PUT") {
        const pw = String((body as { password?: string }).password ?? "");
        if (pw.length < 6) return this.json(422, { code: 422, error_code: "weak_password", msg: "Password should be at least 6 characters." });
        if (pw === entry[1].password) return this.json(422, { code: 422, error_code: "same_password", msg: "New password should be different from the old password." });
        entry[1].password = pw;
      }
      return this.json(200, { id: uid, aud: "authenticated", role: "authenticated", email: entry[0], identities: [{ id: uid }] });
    }
    if (url.pathname === "/auth/v1/logout") {
      if (this.faults.logout === "network") throw new TypeError("fetch failed");
      if (this.faults.logout === "server-error") return this.json(500, { code: 500, msg: "boom" });
      return this.json(204, undefined);
    }
    return this.json(404, { message: `MOCK: auth route ${method} ${url.pathname} not supported` });
  }

  // ---------------------------------------------------------------- delete-account Edge Function (runs the REAL core.ts)
  /** Where the service-role calls land: it can only do what core.ts asks, on this in-memory store. */
  private adminForFunction(): Admin {
    return {
      listStorage: async (folder, offset, limit) => {
        if (this.faults.deleteAccount === "storage") throw new Error("storage unavailable");
        const prefix = folder + "/";
        const names = new Map<string, boolean>(); // child name -> is a folder
        for (const path of [...this.objects.keys()].sort()) {
          if (!path.startsWith(prefix)) continue;
          const rest = path.slice(prefix.length);
          const [first, ...more] = rest.split("/");
          names.set(first, more.length > 0);
        }
        return [...names].slice(offset, offset + limit).map(([name, isFolder]) => ({ name, isFolder }));
      },
      removeStorage: async (paths) => {
        for (const p of paths) this.objects.delete(p);
      },
      deleteRows: async (table, userId) => {
        if (this.faults.deleteAccount === "data" && table === "items") throw new Error("database unavailable");
        this.tables[table] = this.tables[table].filter((r) => r.user_id !== userId);
      },
      deleteUser: async (userId) => {
        if (this.faults.deleteAccount === "user") throw new Error("auth admin unavailable");
        for (const [email, u] of this.users) if (u.id === userId) this.users.delete(email);
      },
    };
  }

  private async deleteAccountFunction(method: string, init?: RequestInit): Promise<Response> {
    const fault = this.faults.deleteAccount;
    if (fault === "not-deployed") return this.json(404, { code: "NOT_FOUND", message: "Requested function was not found" });
    if (fault === "network") throw new TypeError("fetch failed");
    if (method !== "POST") return this.json(405, { error: "Use POST." });
    const headers = new Headers(init?.headers);
    const token = /^Bearer (.+)$/.exec(headers.get("authorization") ?? "")?.[1];
    const uid = subOf(headers);
    if (!token || !uid || ![...this.users.values()].some((u) => u.id === uid)) return this.json(401, { error: "Your session has expired. Sign in again." });
    const body = init?.body ? (JSON.parse(String(init.body)) as { confirm?: unknown }) : {};
    if (body.confirm !== "DELETE") return this.json(400, { error: "Confirmation is missing." });
    if (fault === "stale-token" || !isFresh(token)) return this.json(403, { error: "Please confirm your password again.", reauthenticate: true });
    try {
      await runDeletion(this.adminForFunction(), uid);
      return this.json(200, { ok: true });
    } catch (e) {
      const stage = e instanceof DeletionError ? e.stage : "account";
      return this.json(500, { ok: false, stage, error: e instanceof Error ? e.message : "failed" });
    }
  }

  // ---------------------------------------------------------------- PostgREST subset
  private rest(url: URL, method: string, uid: string, init?: RequestInit): Response {
    const name = url.pathname.replace("/rest/v1/", "");
    if (this.faults.missingTable === name || !(name in this.tables)) {
      return this.json(404, { code: "PGRST205", message: `Could not find the table 'public.${name}' in the schema cache`, hint: null });
    }
    const rows = this.tables[name];
    const matches = (r: Row) => {
      if (r.user_id !== uid) return false; // owner-only policy: other people's rows don't exist for this user
      for (const [col, expr] of url.searchParams) {
        if (["select", "order", "limit", "on_conflict", "columns"].includes(col)) continue;
        const [neg, op, val] = expr.startsWith("not.") ? [true, ...split(expr.slice(4))] : [false, ...split(expr)];
        const v = r[col];
        let ok: boolean;
        if (op === "eq") ok = String(v) === val;
        else if (op === "neq") ok = String(v) !== val;
        else if (op === "is") ok = val === "null" ? v == null : String(v) === val;
        else if (op === "in") ok = val.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, "")).includes(String(v));
        else throw new Error(`MOCK: filter ${op} not supported`);
        if (neg ? ok : !ok) return false;
      }
      return true;
    };
    const body = init?.body ? (JSON.parse(String(init.body)) as Row | Row[]) : undefined;
    const prefer = new Headers(init?.headers).get("prefer") ?? "";

    if (method === "GET") {
      let out = rows.filter(matches);
      const order = url.searchParams.get("order");
      if (order) {
        const [col, dir] = order.split(".");
        out = [...out].sort((a, b) => (Number(a[col]) - Number(b[col])) * (dir === "desc" ? -1 : 1));
      }
      const limit = url.searchParams.get("limit");
      if (limit) out = out.slice(0, Number(limit));
      return this.json(200, out);
    }
    if (method === "POST") {
      const list = Array.isArray(body) ? body : [body as Row];
      if (list.some((row) => (row.user_id ?? uid) !== uid)) return this.json(403, { code: "42501", message: `new row violates row-level security policy for table "${name}"` });
      for (const row of list) row.user_id ??= uid;
      const key = (url.searchParams.get("on_conflict") ?? "id").split(",");
      for (const row of list) {
        const at = rows.findIndex((r) => key.every((k) => r[k] === row[k]));
        if (at >= 0) {
          if (prefer.includes("ignore-duplicates")) continue;
          if (!prefer.includes("merge-duplicates")) return this.json(409, { code: "23505", message: "duplicate key value violates unique constraint" });
          rows[at] = { ...rows[at], ...row };
        } else rows.push({ ...row });
      }
      return this.json(201, undefined);
    }
    if (method === "PATCH") {
      for (const r of rows.filter(matches)) Object.assign(r, body);
      return this.json(204, undefined);
    }
    if (method === "DELETE") {
      this.tables[name] = rows.filter((r) => !matches(r));
      if (name === "chats") this.tables.chat_messages = this.tables.chat_messages.filter((m) => this.tables.chats.some((c) => c.id === m.chat_id && c.user_id === m.user_id));
      return this.json(204, undefined);
    }
    return this.json(405, { message: "method" });
  }

  // ---------------------------------------------------------------- Storage subset
  private storage(url: URL, method: string, uid: string, init?: RequestInit): Response {
    const p = url.pathname.replace("/storage/v1/", "");
    const f = this.faults.storage;
    const err = (status: number, error: string, message: string) => this.json(status, { statusCode: String(status), error, message });
    if (f === "no-bucket") return err(404, "Bucket not found", "Bucket not found");
    const mine = (path: string) => path.split("/")[0] === uid; // storage policy: first folder must be the user's id

    if (method === "POST" && p.startsWith("object/sign/wardrobe")) {
      const { paths } = JSON.parse(String(init?.body)) as { paths: string[] };
      return this.json(200, paths.map((path) => mine(path) && this.objects.has(path)
        ? { error: null, path, signedURL: `/object/sign/wardrobe/${path}?token=mock-${++this.signCount}` }
        : { error: "Object not found", path, signedURL: null }));
    }
    if (method === "POST" && p.startsWith("object/wardrobe/")) {
      if (f === "rls") return err(403, "Unauthorized", "new row violates row-level security policy");
      if (f === "too-large") return err(413, "Payload too large", "The object exceeded the maximum allowed size");
      if (f === "bad-mime") return err(415, "invalid_mime_type", "mime type text/plain is not supported");
      const path = decodeURIComponent(p.replace("object/wardrobe/", ""));
      if (!mine(path)) return err(403, "Unauthorized", "new row violates row-level security policy");
      this.objects.set(path, 1);
      return this.json(200, { Key: `wardrobe/${path}`, Id: "mock" });
    }
    if (method === "DELETE" && p === "object/wardrobe") {
      if (f === "delete-fails") return err(500, "Internal", "storage unavailable");
      const { prefixes } = JSON.parse(String(init?.body)) as { prefixes: string[] };
      for (const x of prefixes) if (mine(x)) this.objects.delete(x);
      return this.json(200, prefixes.filter(mine).map((name) => ({ name })));
    }
    return this.json(404, { message: `MOCK: storage route ${method} ${p} not supported` });
  }
}

function split(expr: string): [string, string] {
  const i = expr.indexOf(".");
  return [expr.slice(0, i), expr.slice(i + 1)];
}

/** The smallest thing that passes as a photo to the data layer. */
export const photo = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
