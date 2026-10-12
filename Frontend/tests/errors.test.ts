import { test } from "node:test";
import assert from "node:assert/strict";
import { explainSupabaseError } from "../src/lib/supabase-errors";

test("recognised errors get a fix; unknown ones stay null so the original text is kept", () => {
  assert.match(explainSupabaseError({ message: "Bucket not found", statusCode: "404" }, "storage")!, /doesn't exist/);
  assert.match(explainSupabaseError({ message: "new row violates row-level security policy", statusCode: "403" }, "storage")!, /no policy/);
  assert.match(explainSupabaseError({ message: "x", code: "PGRST205" }, "database")!, /table is missing/);
  assert.match(explainSupabaseError({ message: "Invalid API key" }, "database")!, /rejected the API key/);
  assert.equal(explainSupabaseError({ message: "something odd" }, "storage"), null);
  assert.equal(explainSupabaseError(null, "database"), null);
});
