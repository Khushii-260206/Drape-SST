/*
 * Turns the errors Supabase returns into sentences that say what to fix. Kept free of imports so it can be
 * tested on its own. The raw error is never hidden entirely: unknown errors keep their original message.
 */

export type SupabaseErrorLike = {
  message?: string;
  code?: string;
  status?: number | string;
  statusCode?: number | string;
  error?: string;
  hint?: string;
};

export type ErrorArea = "storage" | "database";

const SETUP = "Run Backend/supabase/schema.secure.sql in your Supabase project (SQL Editor).";

/** A readable explanation, or null when the error isn't one we recognise. */
export function explainSupabaseError(err: SupabaseErrorLike | null | undefined, area: ErrorArea): string | null {
  if (!err) return null;
  const msg = `${err.message ?? ""} ${err.error ?? ""}`.toLowerCase();
  const code = String(err.code ?? "");
  const status = Number(err.statusCode ?? err.status ?? 0);

  // Wrong or missing project key / URL.
  if (/invalid api key|invalid jwt|jwt expired|no api key/.test(msg) || code === "PGRST301" || code === "PGRST302") {
    return "Supabase rejected the API key. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (they must come from the same project).";
  }

  if (area === "storage") {
    if (/bucket not found/.test(msg) || (status === 404 && /bucket/.test(msg))) {
      return `The photo bucket "wardrobe" doesn't exist in this Supabase project. ${SETUP}`;
    }
    if (/row-level security|violates row-level|not authorized|unauthorized/.test(msg) || status === 403 || status === 401) {
      return `Supabase refused the photo upload: the "wardrobe" bucket has no policy that allows it. ${SETUP}`;
    }
    if (/exceeded the maximum|too large|payload too large/.test(msg) || status === 413) {
      return "That photo is too large for the bucket (limit 10 MB). Try a smaller one.";
    }
    if (/mime type|not supported|invalid mime/.test(msg) || status === 415) {
      return "The bucket only accepts JPEG, PNG or WebP photos.";
    }
    return null;
  }

  // database
  if (code === "PGRST205" || code === "42P01" || /could not find the table|does not exist/.test(msg)) {
    return `A table is missing in this Supabase project. ${SETUP}`;
  }
  if (code === "42703" || code === "PGRST204" || /could not find the '.*' column|column .* does not exist/.test(msg)) {
    return `The database is out of date (a column is missing). ${SETUP}`;
  }
  if (code === "42501" || /row-level security|permission denied/.test(msg)) {
    return `Supabase refused the request: no policy allows it. ${SETUP}`;
  }
  return null;
}
