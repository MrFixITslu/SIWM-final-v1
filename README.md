# SIWM - Smart Warehouse Management System

A multi-tenant shipping/inventory/warehouse management app. React + Vite
frontend, Express + PostgreSQL backend, served from a single container.

## Local development

```bash
npm install
cp .env.example .env   # fill in a JWT_SECRET at minimum; DB is optional
npm run dev            # runs the API + Vite dev server via tsx
```

Without a reachable Postgres, the server falls back to in-memory storage
automatically - fine for local UI work, not for anything you want to keep.

## Environment variables

See `.env.example` for the full list. The important ones:

| Variable | Required | Notes |
|---|---|---|
| `JWT_SECRET` | **Yes, in production** | Server refuses to start without it. Generate with `openssl rand -base64 48`. |
| `DATABASE_URL` / `DB_*` | Recommended | Point at a dedicated database + role for this app, not a shared superuser. |
| `DATA_ENCRYPTION_SECRET` | Optional | Only set on a brand-new deployment - see the warning in `.env.example`. |
| `SEED_DEMO_DATA` | Optional | Leave `false` in production. |

## Production deployment (Docker)

```bash
cp .env.example .env
# edit .env: JWT_SECRET, DB_*, PORT to match your existing NPM proxy target
docker compose up -d --build
```

This builds one image (multi-stage `Dockerfile`) that serves the API and the
built frontend from a single Express process on one port, and runs on the
external `proxy_network` so Nginx Proxy Manager can reach it by container
name - no ports are published to the host.

## Starting fresh / clearing existing accounts

To wipe everything and start clean (e.g. before your first real users sign
up), run the one-time script in `scripts/reset-production-data.sql` directly
against your Postgres database - see the comments in that file for exact
commands. This is intentionally a script you run yourself, not a button in
the app: an HTTP-reachable "delete everyone's data" endpoint would let any
single logged-in admin destroy every other tenant's warehouse.

With `SEED_DEMO_DATA` left unset/`false`, the database stays empty across
restarts after this runs.

## Deleting your own account & warehouse (in-app)

Logged-in admins can permanently delete their own warehouse and account from
the sidebar ("Delete Warehouse & Account"). This requires:
- An existing, authenticated account (the button doesn't exist pre-login)
- Admin role on that warehouse
- Typing `WIPE` and re-entering your password to confirm
- An explicit click - it is never triggered automatically

It only affects the caller's own warehouse and account; other tenants are
untouched.

## Known limitations / follow-ups

- **Social sign-in (Google/Facebook) is disabled.** The previous version
  simulated SSO client-side and trusted a client-supplied email server-side
  with no real verification - a full account-takeover bug. Wiring up real
  SSO requires OAuth credentials from Google/Facebook for this domain and
  server-side token verification (e.g. `google-auth-library`).
- **Invite passwords** are now randomly generated per invited user rather
  than a shared static default - share the one-time password shown in the
  invite response securely.
