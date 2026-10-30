# Local stack without Docker

`start.sh` runs the real **Supabase Auth** (GoTrue) and **PostgREST** binaries against a local PostgreSQL, behind `gateway.mjs` on port 54321, the same URL layout as Supabase (`/auth/v1`, `/rest/v1`, `/storage/v1`).

It exists because the environment this project was built in had no Docker. With Docker, prefer `npx supabase start`.

**Storage is emulated** (in memory: upload, delete, signed URL), and the gateway only accepts the service role for it. That's enough for the app, which only touches Storage from the server with the service role.

```bash
bash tests/local-stack/start.sh      # needs PostgreSQL 15+ on PGPORT (default 5433)
npm run build && npm start
python tests/e2e/smoke.py
```
