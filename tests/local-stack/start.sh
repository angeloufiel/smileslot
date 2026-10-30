#!/usr/bin/env bash
# Runs the REAL Supabase Auth (GoTrue) and PostgREST servers against a local PostgreSQL,
# behind a tiny gateway on :54321, without Docker. Used for the end-to-end browser test.
#
# The usual way is `npx supabase start` (needs Docker). This script exists because the
# build environment had no Docker; it is optional for normal development.
#
# Needs: PostgreSQL 15+ running locally (set PSQL / PGHOST / PGPORT), Node 20+, curl.
# Storage is EMULATED by tests/local-stack/gateway.mjs (upload, delete, signed URL only).
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(pwd)
DIR="$ROOT/.local-stack"
mkdir -p "$DIR"
PGHOST="${PGHOST:-127.0.0.1}"; PGPORT="${PGPORT:-5433}"
PSQL="${PSQL:-psql -h /tmp -p $PGPORT -U postgres}"
DB=smileslot_e2e
SECRET="local-e2e-secret-at-least-32-characters-long!!"

[ -x "$DIR/postgrest" ] || { curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.12/postgrest-v12.2.12-linux-static-x86-64.tar.xz | tar xJ -C "$DIR"; }
[ -x "$DIR/auth/auth" ] || { mkdir -p "$DIR/auth"; curl -sSL https://github.com/supabase/auth/releases/download/v2.186.0/auth-v2.186.0-x86.tar.gz | tar xz -C "$DIR/auth"; }

$PSQL -q -c "drop database if exists $DB" -c "create database $DB"
$PSQL -q -v ON_ERROR_STOP=1 -d $DB -f tests/local-stack/setup_roles.sql -f tests/local-stack/pre_auth.sql

export DATABASE_URL="postgres://supabase_auth_admin:pw@$PGHOST:$PGPORT/$DB?search_path=auth&sslmode=disable"
export GOTRUE_DB_DRIVER=postgres GOTRUE_API_HOST=127.0.0.1 PORT=9999 \
  API_EXTERNAL_URL=http://localhost:54321/auth/v1 GOTRUE_SITE_URL=http://localhost:3000 \
  GOTRUE_URI_ALLOW_LIST="http://localhost:3000/**" GOTRUE_JWT_SECRET="$SECRET" GOTRUE_JWT_EXP=3600 \
  GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role \
  GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_LOG_LEVEL=warn
"$DIR/auth/auth" migrate

$PSQL -q -v ON_ERROR_STOP=1 -d $DB -f tests/local-stack/post_auth.sql
for f in supabase/migrations/*.sql supabase/seed.sql; do $PSQL -q -v ON_ERROR_STOP=1 -d $DB -f "$f" > /dev/null; done
$PSQL -q -v ON_ERROR_STOP=1 -d $DB -f tests/local-stack/post_app.sql

nohup "$DIR/auth/auth" serve > "$DIR/auth.log" 2>&1 &
sed "s#127.0.0.1:5433#$PGHOST:$PGPORT#" tests/local-stack/pgrst.conf > "$DIR/pgrst.conf"
nohup "$DIR/postgrest" "$DIR/pgrst.conf" > "$DIR/postgrest.log" 2>&1 &
nohup node tests/local-stack/gateway.mjs > "$DIR/gateway.log" 2>&1 &

eval "$(node tests/local-stack/mkjwt.mjs)"
cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$ANON
SUPABASE_SECRET_KEY=$SERVICE
NEXT_PUBLIC_SITE_URL=http://localhost:3000
DEMO_PASSWORD=local-test-only-pw
EOF
sleep 3
npm run seed:users
echo "Local stack ready on :54321. Now: npm run build && npm start, then python tests/e2e/smoke.py"
