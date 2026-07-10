-- One-time reset: deletes ALL existing accounts, warehouses, and data so the
-- app starts fresh in production. This is deliberately a script YOU run
-- directly against Postgres, not an HTTP endpoint in the running app - a
-- whole-database wipe reachable over the web, no matter how authenticated,
-- would let any one tenant destroy every other tenant's data.
--
-- Run it once, before you start onboarding real users. After this runs, and
-- with SEED_DEMO_DATA left unset/false, the database stays empty - no demo
-- account will reappear on restart.
--
-- Usage (from the machine running the container):
--   docker exec -i <your-postgres-container> psql -U <user> -d <database> \
--     < scripts/reset-production-data.sql
--
-- Or, if this app's Postgres is already running, from inside this repo:
--   psql "$DATABASE_URL" -f scripts/reset-production-data.sql

BEGIN;

TRUNCATE TABLE
  transactions,
  items,
  categories,
  suppliers,
  zones,
  user_warehouses,
  users,
  warehouses
RESTART IDENTITY CASCADE;

COMMIT;

-- Verify it's actually empty:
-- SELECT
--   (SELECT COUNT(*) FROM warehouses) AS warehouses,
--   (SELECT COUNT(*) FROM users) AS users,
--   (SELECT COUNT(*) FROM items) AS items;
