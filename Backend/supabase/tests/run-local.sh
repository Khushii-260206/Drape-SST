#!/usr/bin/env bash
# Runs the SQL policy tests on a throwaway local Postgres (Postgres.app or any install with initdb on PATH).
# It never connects to Supabase. Usage: Backend/supabase/tests/run-local.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; sql="$here/.."
PGBIN="${PGBIN:-/Applications/Postgres.app/Contents/Versions/latest/bin}"; export PATH="$PGBIN:$PATH"
dir="$(mktemp -d)"; port="${PGPORT_TEST:-54329}"
trap 'pg_ctl -D "$dir/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$dir"' EXIT
initdb -D "$dir/data" -U postgres --auth=trust -E UTF8 >/dev/null
pg_ctl -D "$dir/data" -o "-p $port -k $dir -c listen_addresses=''" -l "$dir/log" -w start >/dev/null
q() { psql -h "$dir" -p "$port" -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }
fresh() { q -d postgres -c "drop database if exists $1" -c "create database $1" ; q -d "$1" -f "$here/stub.sql" -f "$here/helpers.sql" >/dev/null; }
run() { q -d "$1" -f "$2" 2>&1 | grep -E 'NOTICE:  (PASS|FAIL)|ERROR' | sed 's/.*NOTICE:  //' || true; }

echo "== 1. open schema.sql (current app): what the public key can do"
fresh open; q -d open -f "$sql/schema.sql" >/dev/null; run open "$here/rls_open_demo.sql"
echo "== 2. lockdown.sql on top of the open schema"
fresh lock; q -d lock -f "$sql/schema.sql" >/dev/null; q -d lock -f "$sql/lockdown.sql" >/dev/null; q -d lock -f "$sql/lockdown.sql" >/dev/null; run lock "$here/rls_lockdown.sql"
echo "== 3. schema.secure.sql: owner-only access (run twice to prove it is idempotent)"
fresh secure; q -d secure -f "$sql/schema.secure.sql" >/dev/null; q -d secure -f "$sql/schema.secure.sql" >/dev/null; echo "PASS  schema.secure.sql re-runs cleanly"
run secure "$here/rls_secure.sql"
echo "== 4. schema.secure.sql refuses to run over the old open tables"
fresh guard; q -d guard -f "$sql/schema.sql" >/dev/null
if q -d guard -f "$sql/schema.secure.sql" >/dev/null 2>"$dir/err"; then echo "FAIL  secure schema ran over open tables"; exit 1; else grep -q "old open schema" "$dir/err" && echo "PASS  refused to run over the old open schema"; fi
