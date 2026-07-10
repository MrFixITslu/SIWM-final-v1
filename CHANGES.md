# SIWM-final-v1: Security fixes & production readiness

## What I found

This repo was an AI Studio-generated prototype. It compiled and ran fine,
but had several issues that are fine for a sandbox demo and dangerous in
production:

1. **Unauthenticated database wipe.** `/api/system/wipe-all` had no auth at
   all - anyone could POST to it and delete every account and every
   tenant's data. Its trigger button was on the pre-login screen, so a
   login wasn't even required to reach it in the UI. A second copy sat in
   the authenticated sidebar with no admin check.
2. **Fake OAuth = account takeover.** The "Google"/"Facebook" login buttons
   simulated SSO client-side (hardcoded a fixed demo email) and the backend
   trusted whatever email/provider/providerId the client sent, no real
   verification. Anyone could log in as any existing user by just naming
   their email - no password needed.
3. **Public hardcoded secrets.** `JWT_SECRET` and the data-encryption key
   both fell back to a fixed string baked into this public repo, and
   `docker-compose.yml` had `postgres:postgres` hardcoded. Since this
   repo is public, that secret is now public knowledge.
4. **Demo account reseeded every boot.** `demo@siwm.org` / a known password
   hash got recreated on every server start, regardless of what was in the
   database - so "wiping and starting fresh" couldn't actually stick.
5. **Weak encryption.** Item data was encrypted with AES-256-CBC using a
   static, predictable IV per warehouse (same plaintext -> same ciphertext,
   every time).
6. **Shared invite password.** Every newly invited operator got the exact
   same hardcoded password (`welcome123`).
7. **Split-container deployment** (nginx + Express + hardcoded creds)
   didn't match your other apps' single-container/NPM pattern, and had a
   latent bug: the backend's own static-file-serving code path had no
   `index.html` to serve if it ever ran standalone.

## What changed

- Removed the unauthenticated wipe endpoint entirely. Replaced with
  `POST /api/account/wipe-my-data`: requires a logged-in account, admin
  role, password re-verification, and typing `WIPE`. Scoped to the caller's
  own warehouse + account only - it can never touch another tenant's data.
  The button is gone from the pre-login screen (there's no "existing
  account" there); the sidebar button now only renders for admins.
- Disabled the fake OAuth endpoint (`501 Not Implemented`) and removed the
  simulated SSO buttons from the login screen.
- `JWT_SECRET` now fails fast on boot in production if unset, instead of
  silently using the old public default.
- Encryption upgraded to AES-256-GCM with a random IV + auth tag per
  record, via its own `DATA_ENCRYPTION_SECRET`. Decryption still handles
  the old format so already-encrypted data isn't broken by this change.
- Demo seeding now requires `SEED_DEMO_DATA=true`; off by default.
- Invited operators each get a unique random temporary password.
- Consolidated to a single `Dockerfile` + `docker-compose.yml`, running as
  a non-root user, reading secrets from a git-ignored `.env`.
- Added `.gitignore`, rewrote `.env.example` and `README.md`.
- Added `scripts/reset-production-data.sql` - a one-time script **you**
  run directly against Postgres to clear all existing accounts/data before
  go-live (deliberately not an HTTP endpoint - see the file for why).

Verified: `tsc --noEmit` clean, full build succeeds, and I ran the compiled
server end-to-end (register, login, invite, item data round-trip through
the new encryption, and the full wipe flow including wrong-password /
wrong-confirmation / correct-flow / post-wipe-login-fails cases).

## What I could not do

- **Push to GitHub.** I don't have write credentials for your repo and no
  GitHub connector is available in this environment. Everything above is
  committed locally in the delivered copy - see "How to ship this" below.
- **Run the reset script against your live database.** I can't reach your
  homelab from this sandbox. Run `scripts/reset-production-data.sql`
  yourself per the instructions in that file.
- **Real Google/Facebook login.** That needs OAuth client credentials from
  Google/Facebook for your exact domain, which only you can obtain. Happy
  to wire it up once you have them.

## How to ship this

You have two options in the delivered files:

**Option A - full repo (recommended):** unzip `SIWM-final-v1-fixed.zip`
(it includes `.git`, with everything above already committed on top of
your `main`). From inside that folder:
```bash
git remote -v   # confirm it points at your repo
git push origin main
```
You'll be prompted for GitHub credentials (a personal access token, not
your password) if you haven't got one cached.

**Option B - patch file:** apply `siwm-fixes.patch` to your existing local
clone:
```bash
cd /path/to/your/existing/SIWM-final-v1
git apply /path/to/siwm-fixes.patch
git add -A && git commit -m "Security fixes and production readiness"
git push origin main
```

## Before you deploy

1. Copy `.env.example` to `.env` and fill in a real `JWT_SECRET`
   (`openssl rand -base64 48`).
2. Point `DATABASE_URL`/`DB_*` at a dedicated database + role, not a
   shared Postgres superuser.
3. Set `PORT` to whatever your Nginx Proxy Manager host already targets
   for `siwm.v79sl.duckdns.org`.
4. Run `scripts/reset-production-data.sql` once against that database.
5. Leave `SEED_DEMO_DATA` unset/`false`.
6. `docker compose up -d --build`.

Any existing sessions will be invalidated once `JWT_SECRET` changes -
that's expected; users just log in again.
