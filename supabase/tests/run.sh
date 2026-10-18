#!/usr/bin/env bash
# Runs the migration + 70+ scenario checks against a LOCAL throwaway Postgres (no Supabase needed).
# The mock file fakes Supabase's auth schema and roles. Usage: ./run.sh  (needs psql and a running local server)
set -euo pipefail
DB=${DB:-campuspass_test}
dropdb --if-exists "$DB"; createdb "$DB"
psql -q -d "$DB" -f 00_mock_supabase.sql >/dev/null 2>&1 || true
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f ../migrations/0001_campuspass_schema.sql
psql -d "$DB" -q -f 01_seed_users.sql -f 02_scenarios.sql | tee /tmp/campuspass-sql-results.txt | grep -E "\| (PASS|FAIL)" || true
echo "PASS: $(grep -c '| PASS' /tmp/campuspass-sql-results.txt)  FAIL: $(grep -c '| FAIL' /tmp/campuspass-sql-results.txt)"
