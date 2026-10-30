#!/usr/bin/env bash
# Builds a throw-away database from the real migrations and runs every DB test.
# Needs a local PostgreSQL 15+ server. Override connection with PSQL="psql ..." if needed.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PSQL="${PSQL:-psql -h /tmp -p 5433 -U postgres}"
export DB="${DB:-smileslot_test}"

$PSQL -q -c "drop database if exists $DB" -c "create database $DB"
for f in tests/db/00_supabase_stub.sql supabase/migrations/*.sql supabase/seed.sql; do
  $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" > /dev/null
done
echo "Migrations and seed loaded."

$PSQL -qAt -v ON_ERROR_STOP=1 -d "$DB" -f tests/db/10_security_and_booking.sql 2>&1 \
  | sed -e "s/^psql:[^ ]* NOTICE:  //" -e "s/^NOTICE:  //" | grep -E "PASS|FAIL|ERROR|=====|ALL TESTS|Test date|race"
bash tests/db/20_race_condition.sh
