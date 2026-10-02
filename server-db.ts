import pg from 'pg';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { 
  INITIAL_CATEGORIES, 
  INITIAL_SUPPLIERS, 
  INITIAL_ZONES, 
  INITIAL_ITEMS, 
  INITIAL_TRANSACTIONS 
} from './src/mockData.js';
import { sealEvent, verifyEventChain, type SwimBusinessEvent } from './src/domain/events.js';
import type { ShipmentRecord, LogisticsUnit } from './src/domain/shipping.js';
import type { TrackingCheckpoint } from './src/domain/tracking.js';
import type { CustomsChargeRule, CustomsEstimate, CustomsEstimateInput } from './src/domain/customs.js';
import { normalizeRole } from './src/domain/permissions.js';
import {
  WORKSPACE_INVITE_TTL_HOURS,
  hashWorkspaceInvitationToken,
  invitationIsActive,
  invitedEmailMatches,
  isAssignableWorkspaceRole,
  maskInvitationEmail,
  normalizeInvitationEmail,
} from './src/domain/invitations.js';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
const dbConfig = {
  host: process.env.PGHOST || process.env.DB_HOST || 'postgres',
  port: parseInt(process.env.PGPORT || process.env.DB_PORT || '5432', 10),
  user: process.env.PGUSER || process.env.DB_USER || 'postgres',
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD || 'postgres',
  database: process.env.PGDATABASE || process.env.DB_NAME || 'postgres',
};

let pool: any = null;
let usePostgres = false;

// --- Multi-Tenant Symmetric Encryption Setup ---
// Encryption keys are deliberately separate from JWT/session secrets. Production
// must provide an external secret; SWIM never ships a usable production key.
function resolveDataEncryptionSecret(): string {
  const configured = process.env.DATA_ENCRYPTION_SECRET?.trim();
  if (configured && Buffer.byteLength(configured, 'utf8') >= 32) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: DATA_ENCRYPTION_SECRET must be configured with at least 32 bytes in production.');
  }
  console.warn('WARNING: DATA_ENCRYPTION_SECRET is using a development-only fallback.');
  return 'swim-development-only-data-encryption-secret-change-before-production';
}

const DATA_ENCRYPTION_SECRET = resolveDataEncryptionSecret();

function resolveEventLedgerSecret(): string {
  const configured = process.env.EVENT_LEDGER_SECRET?.trim();
  if (configured && Buffer.byteLength(configured, 'utf8') >= 32) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: EVENT_LEDGER_SECRET must be configured with at least 32 bytes in production.');
  }
  console.warn('WARNING: EVENT_LEDGER_SECRET is using a development-only fallback.');
  return 'swim-development-only-event-ledger-secret-change-before-production';
}
const EVENT_LEDGER_SECRET = resolveEventLedgerSecret();

// Historical key derivation retained only for decrypting encv2 records created
// before SWIM introduced HKDF-separated tenant encryption keys.
function getLegacyWarehouseKey(warehouseId: string): Buffer {
  return crypto.createHash('sha256').update(warehouseId + DATA_ENCRYPTION_SECRET).digest();
}

function getWarehouseKey(warehouseId: string): Buffer {
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    Buffer.from(DATA_ENCRYPTION_SECRET, 'utf8'),
    Buffer.from(warehouseId, 'utf8'),
    Buffer.from('swim-tenant-field-encryption-v3', 'utf8'),
    32,
  ));
}

// Whether to auto-create the built-in demo account/warehouse on every boot.
// Defaults OFF so a fresh/wiped database actually stays fresh across restarts.
const SEED_DEMO_DATA = (process.env.SEED_DEMO_DATA || 'false').toLowerCase() === 'true';

export function encryptText(text: string | null | undefined, warehouseId: string): string {
  if (!text) return '';
  try {
    const key = getWarehouseKey(warehouseId);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `encv3_${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error('Encryption error:', err);
    return text || '';
  }
}

export function decryptText(encryptedText: string | null | undefined, warehouseId: string): string {
  if (!encryptedText) return '';
  const key = getWarehouseKey(warehouseId);

  if (encryptedText.startsWith('encv3_')) {
    try {
      const [ivHex, authTagHex, cipherHex] = encryptedText.substring(6).split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      console.error('Decryption error:', err);
      return encryptedText;
    }
  }

  if (encryptedText.startsWith('encv2_')) {
    try {
      const [ivHex, authTagHex, cipherHex] = encryptedText.substring(6).split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-gcm', getLegacyWarehouseKey(warehouseId), iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      console.error('Decryption error:', err);
      return encryptedText;
    }
  }

  // Legacy format from before the AES-256-GCM upgrade: AES-256-CBC with a
  // static per-warehouse IV. Kept only so previously-stored data (encrypted
  // before this fix shipped) keeps decrypting correctly.
  if (encryptedText.startsWith('enc_')) {
    try {
      const ciphertext = encryptedText.substring(4);
      const legacyIv = crypto.createHash('md5').update(warehouseId).digest();
      const decipher = crypto.createDecipheriv('aes-256-cbc', getLegacyWarehouseKey(warehouseId), legacyIv);
      let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      return encryptedText;
    }
  }

  return encryptedText;
}

// --- Multi-Tenant In-Memory Storage Fallbacks ---
let memUserWarehouses: any[] = [];

let memWarehouses: any[] = [];

let memUsers: any[] = [];

// Initialize in-memory arrays with 'wh-demo' mappings for initial seed data
let memCategories: any[] = [];

let memSuppliers: any[] = [];

let memZones: any[] = [];

let memItems: any[] = [];

let memTransactions: any[] = [];

let memPurchaseOrders: any[] = [];

let memAuditLogs: any[] = [];

let memDispatchRecords: any[] = [];
let memShipments: any[] = [];
let memTrackingEvents: any[] = [];
let memLogisticsUnits: any[] = [];
let memCustomsRules: any[] = [];
let memCustomsEstimates: any[] = [];
let memWebhookReceipts: any[] = [];
let memBusinessEvents: SwimBusinessEvent[] = [];
let memWorkspaceInvitations: any[] = [];

export async function initDb() {
  console.log('Initializing database connectivity...');
  
  const hasPgEnv = !!(process.env.DATABASE_URL || process.env.DB_HOST || process.env.PGHOST);
  if (!hasPgEnv) {
    console.log('No PostgreSQL environment variables (DATABASE_URL, DB_HOST, PGHOST) detected.');
    console.log('Immediately falling back to memory-backed multi-tenant storage for sandbox AI Studio preview.\n');
    usePostgres = false;
    return;
  }

  console.log(`Database config target: host=${dbConfig.host}:${dbConfig.port}, user=${dbConfig.user}, database=${dbConfig.database}`);
  
  try {
    if (connectionString) {
      pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
    } else {
      pool = new Pool({ ...dbConfig, connectionTimeoutMillis: 5000 });
    }

    // Quick test connection with 5-second timeout
    const testResult = await pool.query('SELECT NOW()');
    console.log('PostgreSQL connection established successfully:', testResult.rows[0].now);
    usePostgres = true;

    // Run Migrations (Create tables if not exists)
    await runMigrations();
  } catch (err: any) {
    console.warn('\n⚠️ WARNING: PostgreSQL connection failed or timed out:', err.message);
    console.warn('Falling back to memory-backed multi-tenant storage for sandbox AI Studio preview.\n');
    usePostgres = false;
  }
}

async function runMigrations() {
  console.log('Verifying PostgreSQL schema tables for multi-tenancy...');
  
  // 1. Warehouses Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS warehouses (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      code VARCHAR(50) NOT NULL UNIQUE,
      address TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Users Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(50) PRIMARY KEY,
      email VARCHAR(150) NOT NULL UNIQUE,
      password_hash TEXT,
      name VARCHAR(100),
      warehouse_id VARCHAR(50) REFERENCES warehouses(id) ON DELETE SET NULL,
      provider VARCHAR(20) NOT NULL DEFAULT 'email',
      provider_id VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 3. Categories Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id VARCHAR(50) PRIMARY KEY,
      warehouse_id VARCHAR(50) NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      name VARCHAR(512) NOT NULL,
      description TEXT,
      color VARCHAR(512),
      UNIQUE(warehouse_id, name)
    )
  `);

  // 4. Suppliers Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id VARCHAR(50) PRIMARY KEY,
      warehouse_id VARCHAR(50) NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      name VARCHAR(512) NOT NULL,
      contact_name VARCHAR(512),
      email VARCHAR(512),
      phone VARCHAR(512),
      address TEXT,
      UNIQUE(warehouse_id, name)
    )
  `);

  // 5. Zones Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zones (
      id VARCHAR(50) PRIMARY KEY,
      warehouse_id VARCHAR(50) NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      name VARCHAR(512) NOT NULL,
      description TEXT,
      max_capacity INT,
      color VARCHAR(512),
      UNIQUE(warehouse_id, name)
    )
  `);

  // 6. Items Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS items (
      id VARCHAR(50) PRIMARY KEY,
      warehouse_id VARCHAR(50) NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      name VARCHAR(1024) NOT NULL,
      sku VARCHAR(512) NOT NULL,
      category VARCHAR(512) NOT NULL,
      quantity INT NOT NULL DEFAULT 0,
      unit VARCHAR(50) NOT NULL DEFAULT 'pcs',
      price DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
      zone VARCHAR(512) NOT NULL,
      aisle VARCHAR(512) NOT NULL,
      shelf VARCHAR(512) NOT NULL,
      bin VARCHAR(512) NOT NULL,
      supplier_id VARCHAR(50) REFERENCES suppliers(id) ON DELETE SET NULL,
      min_threshold INT NOT NULL DEFAULT 10,
      last_updated TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      notes TEXT,
      UNIQUE(warehouse_id, sku)
    )
  `);

  // 7. Transactions Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id VARCHAR(50) PRIMARY KEY,
      warehouse_id VARCHAR(50) NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      item_id VARCHAR(50),
      item_name VARCHAR(1024) NOT NULL,
      sku VARCHAR(512) NOT NULL,
      type VARCHAR(20) NOT NULL,
      quantity INT NOT NULL,
      reason TEXT,
      timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      operator VARCHAR(512)
    )
  `);

  // 8. User Warehouses Mapping Table (Supporting up to 2 warehouses per user)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_warehouses (
      user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      warehouse_id VARCHAR(50) NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, warehouse_id)
    )
  `);

  // 9. Purchase Orders Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id VARCHAR(50) PRIMARY KEY,
      warehouse_id VARCHAR(50) NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      po_number VARCHAR(100) NOT NULL,
      supplier_id VARCHAR(50),
      supplier_name VARCHAR(512),
      status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
      items_json TEXT NOT NULL,
      total_amount DECIMAL(12, 2) DEFAULT 0.00,
      expected_delivery TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 10. Database Migrations (Safely adding layout, contact details, role, batch, and archive columns)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT DEFAULT 1`);
  await pool.query(`ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS email VARCHAR(150)`);
  await pool.query(`ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`);
  await pool.query(`ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS contact_name VARCHAR(100)`);
  await pool.query(`ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS layout_rows INT DEFAULT 5`);
  await pool.query(`ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS layout_cols INT DEFAULT 5`);
  await pool.query(`ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS layout_zones TEXT DEFAULT '[]'`);
  await pool.query(`ALTER TABLE user_warehouses ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'admin'`);

  // 11. System Audit Logs Table (immutable security, authorization, & operations ledger)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id VARCHAR(50) PRIMARY KEY,
      warehouse_id VARCHAR(50) NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      action VARCHAR(100) NOT NULL,
      category VARCHAR(50) NOT NULL,
      details TEXT,
      operator VARCHAR(512),
      operator_id VARCHAR(50),
      ip_address VARCHAR(100),
      status VARCHAR(50) DEFAULT 'SUCCESS',
      timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 12. Personnel Dispatch Records Table (direct personnel and department tracking)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dispatch_records (
      id VARCHAR(50) PRIMARY KEY,
      warehouse_id VARCHAR(50) NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      item_id VARCHAR(50),
      item_name VARCHAR(1024) NOT NULL,
      sku VARCHAR(512) NOT NULL,
      quantity INT NOT NULL,
      recipient_name VARCHAR(512) NOT NULL,
      department VARCHAR(512),
      badge_number VARCHAR(512),
      project_code VARCHAR(512),
      operator VARCHAR(512),
      timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      notes TEXT
    )
  `);

  // Item & Transaction extensions for Batch tracking, Archiving, and Transfers
  await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS batch_number VARCHAR(512)`);
  await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS expiry_date VARCHAR(512)`);

  await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS batch_number VARCHAR(512)`);
  await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source_warehouse_id VARCHAR(50)`);
  await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS dest_warehouse_id VARCHAR(50)`);

  // Programmatic migration to alter column types to TEXT / VARCHAR(512) to support encrypted payloads in existing databases
  try {
    await pool.query(`ALTER TABLE categories ALTER COLUMN name TYPE VARCHAR(512)`);
    await pool.query(`ALTER TABLE categories ALTER COLUMN color TYPE VARCHAR(512)`);
    
    await pool.query(`ALTER TABLE suppliers ALTER COLUMN name TYPE VARCHAR(512)`);
    await pool.query(`ALTER TABLE suppliers ALTER COLUMN contact_name TYPE VARCHAR(512)`);
    await pool.query(`ALTER TABLE suppliers ALTER COLUMN email TYPE VARCHAR(512)`);
    await pool.query(`ALTER TABLE suppliers ALTER COLUMN phone TYPE VARCHAR(512)`);
    
    await pool.query(`ALTER TABLE zones ALTER COLUMN name TYPE VARCHAR(512)`);
    await pool.query(`ALTER TABLE zones ALTER COLUMN color TYPE VARCHAR(512)`);
    
    await pool.query(`ALTER TABLE items ALTER COLUMN name TYPE VARCHAR(1024)`);
    await pool.query(`ALTER TABLE items ALTER COLUMN sku TYPE VARCHAR(512)`);
    await pool.query(`ALTER TABLE items ALTER COLUMN category TYPE VARCHAR(512)`);
    await pool.query(`ALTER TABLE items ALTER COLUMN zone TYPE VARCHAR(512)`);
    await pool.query(`ALTER TABLE items ALTER COLUMN aisle TYPE VARCHAR(512)`);
    await pool.query(`ALTER TABLE items ALTER COLUMN shelf TYPE VARCHAR(512)`);
    await pool.query(`ALTER TABLE items ALTER COLUMN bin TYPE VARCHAR(512)`);
    
    await pool.query(`ALTER TABLE transactions ALTER COLUMN item_name TYPE VARCHAR(1024)`);
    await pool.query(`ALTER TABLE transactions ALTER COLUMN sku TYPE VARCHAR(512)`);
    await pool.query(`ALTER TABLE transactions ALTER COLUMN operator TYPE VARCHAR(512)`);
  } catch (err: any) {
    console.warn('⚠️ Non-critical migration warning:', err.message);
  }

  // 13. SWIM shipment control tower
  await pool.query(`
    CREATE TABLE IF NOT EXISTS swim_shipments (
      id VARCHAR(80) PRIMARY KEY,
      warehouse_id VARCHAR(50) NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      reference VARCHAR(120) NOT NULL,
      mode VARCHAR(30) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'PLANNED',
      carrier VARCHAR(100),
      tracking_number VARCHAR(220),
      tracking_provider VARCHAR(80),
      purchase_order_id VARCHAR(50),
      supplier_id VARCHAR(50),
      customer_order_reference VARCHAR(120),
      origin TEXT,
      destination TEXT,
      estimated_arrival_at TIMESTAMPTZ,
      latest_location TEXT,
      latest_tracking_status VARCHAR(40),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (warehouse_id, reference)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_swim_shipments_warehouse_status ON swim_shipments(warehouse_id, status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_swim_shipments_tracking ON swim_shipments(warehouse_id, tracking_number)`);

  // 14. Normalized carrier checkpoints. Raw provider payloads are not retained by default.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS swim_tracking_events (
      id VARCHAR(80) PRIMARY KEY,
      warehouse_id VARCHAR(50) NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      shipment_id VARCHAR(80) NOT NULL REFERENCES swim_shipments(id) ON DELETE CASCADE,
      carrier_event_id VARCHAR(180),
      status VARCHAR(40) NOT NULL,
      description TEXT NOT NULL,
      location TEXT,
      occurred_at TIMESTAMPTZ NOT NULL,
      estimated_delivery_at TIMESTAMPTZ,
      source VARCHAR(80) NOT NULL,
      payload_hash VARCHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (shipment_id, carrier_event_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_swim_tracking_shipment_time ON swim_tracking_events(warehouse_id, shipment_id, occurred_at DESC)`);

  // Secure webhook replay ledger. Receipt reservation happens before any provider event is applied.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS swim_webhook_receipts (
      replay_key VARCHAR(64) PRIMARY KEY,
      provider_key VARCHAR(40) NOT NULL,
      provider_event_id VARCHAR(180) NOT NULL,
      body_hash VARCHAR(64) NOT NULL,
      warehouse_id VARCHAR(50),
      shipment_id VARCHAR(80),
      received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMPTZ NOT NULL,
      UNIQUE (provider_key, provider_event_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_swim_webhook_expiry ON swim_webhook_receipts(expires_at)`);

  // 15. Item/carton/package/pallet/container hierarchy for consolidation and 3PL workflows.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS swim_logistics_units (
      id VARCHAR(80) PRIMARY KEY,
      warehouse_id VARCHAR(50) NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      shipment_id VARCHAR(80) NOT NULL REFERENCES swim_shipments(id) ON DELETE CASCADE,
      parent_unit_id VARCHAR(80) REFERENCES swim_logistics_units(id) ON DELETE CASCADE,
      unit_type VARCHAR(30) NOT NULL,
      reference VARCHAR(180),
      quantity INTEGER,
      weight_grams INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_swim_units_shipment ON swim_logistics_units(warehouse_id, shipment_id)`);

  // 16. Platform-curated, effective-dated customs rules. Tenant users can read/use but not edit them.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS swim_customs_rules (
      id VARCHAR(100) PRIMARY KEY,
      destination_country VARCHAR(3) NOT NULL,
      hs_code_prefix VARCHAR(20) NOT NULL,
      charge_code VARCHAR(60) NOT NULL,
      label VARCHAR(160) NOT NULL,
      sequence INTEGER NOT NULL,
      basis VARCHAR(40) NOT NULL,
      rate_bps INTEGER,
      fixed_amount_minor BIGINT,
      effective_from DATE NOT NULL,
      effective_to DATE,
      eligible_origins JSONB,
      excluded_origins JSONB,
      required_concession_code VARCHAR(100),
      authority VARCHAR(200) NOT NULL,
      source_url TEXT NOT NULL,
      verified_at TIMESTAMPTZ NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_swim_customs_lookup ON swim_customs_rules(destination_country, hs_code_prefix, effective_from, effective_to)`);

  // 17. Saved estimates keep the exact calculation result/rule provenance used at the time.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS swim_customs_estimates (
      id VARCHAR(80) PRIMARY KEY,
      warehouse_id VARCHAR(50) NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      shipment_id VARCHAR(80) REFERENCES swim_shipments(id) ON DELETE SET NULL,
      input_json JSONB NOT NULL,
      result_json JSONB NOT NULL,
      created_by VARCHAR(50),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 18. Tamper-evident operational event ledger. HMAC chain protects against silent DB-only edits.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS swim_business_events (
      sequence_id BIGSERIAL PRIMARY KEY,
      event_id VARCHAR(80) NOT NULL UNIQUE,
      warehouse_id VARCHAR(50) NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      event_type VARCHAR(80) NOT NULL,
      aggregate_type VARCHAR(40) NOT NULL,
      aggregate_id VARCHAR(100) NOT NULL,
      actor_id VARCHAR(50),
      occurred_at TIMESTAMPTZ NOT NULL,
      payload_json JSONB NOT NULL,
      previous_hash VARCHAR(64),
      event_hash VARCHAR(64) NOT NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_swim_events_aggregate ON swim_business_events(warehouse_id, aggregate_type, aggregate_id, sequence_id)`);


  // 19. Expiring, single-use workspace invitations. Only the token hash is stored.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS swim_workspace_invitations (
      id VARCHAR(80) PRIMARY KEY,
      warehouse_id VARCHAR(50) NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      email VARCHAR(150) NOT NULL,
      display_name VARCHAR(120),
      role VARCHAR(50) NOT NULL,
      token_hash VARCHAR(64) NOT NULL UNIQUE,
      created_by VARCHAR(50) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_swim_invites_workspace_email ON swim_workspace_invitations(warehouse_id, lower(email), created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_swim_invites_token_hash ON swim_workspace_invitations(token_hash)`);

  // Unknown/legacy authorization roles are intentionally reduced to viewer.
  await pool.query(`UPDATE user_warehouses SET role='viewer' WHERE role NOT IN ('admin','manager','operator','viewer')`);

  // Demo account/warehouse seeding is opt-in only (SEED_DEMO_DATA=true). It used
  // to run unconditionally on every boot, which meant a well-known credential
  // (demo@siwm.org) was always publicly guessable and re-appeared even after an
  // operator wiped the database to "start fresh". Enable it only for local/demo
  // environments, never in production.
  if (SEED_DEMO_DATA) {
    const whCheck = await pool.query("SELECT COUNT(*) FROM warehouses WHERE id = 'wh-demo'");
    if (parseInt(whCheck.rows[0].count, 10) === 0) {
      console.log('Seeding default central warehouse (wh-demo)...');
      await pool.query(
        "INSERT INTO warehouses (id, name, code, address, email, phone, contact_name, layout_rows, layout_cols, layout_zones) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        ['wh-demo', 'Demo Central Warehouse', 'DEMO123', '123 Logistics Way, Chicago, IL', 'demo-warehouse@siwm.org', '555-0199', 'Demo Administrator', 6, 8, '[]']
      );
    }

    const userCheck = await pool.query("SELECT COUNT(*) FROM users WHERE email = 'demo@siwm.org'");
    if (parseInt(userCheck.rows[0].count, 10) === 0) {
      console.log('Seeding default demo user (demo@siwm.org)...');
      await pool.query(
        "INSERT INTO users (id, email, password_hash, name, warehouse_id, provider) VALUES ($1, $2, $3, $4, $5, $6)",
        ['usr-demo', 'demo@siwm.org', '$2a$10$W2G6k18vI.hQO639C0YxXuzX3Uj3m7T0O7jV38kXyV1YxW3G03vIq', 'Demo Operator', 'wh-demo', 'email']
      );
    }

    await pool.query(`
      INSERT INTO user_warehouses (user_id, warehouse_id, role)
      VALUES ('usr-demo', 'wh-demo', 'admin')
      ON CONFLICT (user_id, warehouse_id) DO NOTHING
    `);

    await seedWarehouseData('wh-demo');
    console.log('Demo data seeded (SEED_DEMO_DATA=true).');
  }

  console.log('PostgreSQL database migration completed successfully.');
}

// --- Dynamic Warehouse Seeding ---
export async function seedWarehouseData(warehouseId: string) {
  if (usePostgres) {
    // Categories
    const catCheck = await pool.query('SELECT COUNT(*) FROM categories WHERE warehouse_id = $1', [warehouseId]);
    if (parseInt(catCheck.rows[0].count, 10) === 0) {
      console.log(`Seeding categories for warehouse ${warehouseId}...`);
      for (const cat of INITIAL_CATEGORIES) {
        await pool.query(
          'INSERT INTO categories (id, warehouse_id, name, description, color) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
          [`${cat.id}-${warehouseId}`, warehouseId, encryptText(cat.name, warehouseId), encryptText(cat.description, warehouseId), encryptText(cat.color, warehouseId)]
        );
      }
    }

    // Suppliers
    const supCheck = await pool.query('SELECT COUNT(*) FROM suppliers WHERE warehouse_id = $1', [warehouseId]);
    if (parseInt(supCheck.rows[0].count, 10) === 0) {
      console.log(`Seeding suppliers for warehouse ${warehouseId}...`);
      for (const s of INITIAL_SUPPLIERS) {
        await pool.query(
          'INSERT INTO suppliers (id, warehouse_id, name, contact_name, email, phone, address) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING',
          [`${s.id}-${warehouseId}`, warehouseId, encryptText(s.name, warehouseId), encryptText(s.contactName, warehouseId), encryptText(s.email, warehouseId), encryptText(s.phone, warehouseId), encryptText(s.address, warehouseId)]
        );
      }
    }

    // Zones
    const zoneCheck = await pool.query('SELECT COUNT(*) FROM zones WHERE warehouse_id = $1', [warehouseId]);
    if (parseInt(zoneCheck.rows[0].count, 10) === 0) {
      console.log(`Seeding zones for warehouse ${warehouseId}...`);
      for (const z of INITIAL_ZONES) {
        await pool.query(
          'INSERT INTO zones (id, warehouse_id, name, description, max_capacity, color) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING',
          [`${z.id}-${warehouseId}`, warehouseId, encryptText(z.name, warehouseId), encryptText(z.description, warehouseId), z.maxCapacity, encryptText(z.color, warehouseId)]
        );
      }
    }

    // Items
    const itemCheck = await pool.query('SELECT COUNT(*) FROM items WHERE warehouse_id = $1', [warehouseId]);
    if (parseInt(itemCheck.rows[0].count, 10) === 0) {
      console.log(`Seeding items for warehouse ${warehouseId}...`);
      for (const item of INITIAL_ITEMS) {
        const itemSupId = item.supplierId ? `${item.supplierId}-${warehouseId}` : null;
        await pool.query(
          `INSERT INTO items (id, warehouse_id, name, sku, category, quantity, unit, price, zone, aisle, shelf, bin, supplier_id, min_threshold, last_updated, notes) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) ON CONFLICT DO NOTHING`,
          [
            `${item.id}-${warehouseId}`,
            warehouseId,
            encryptText(item.name, warehouseId),
            encryptText(item.sku, warehouseId),
            encryptText(item.category, warehouseId),
            item.quantity,
            item.unit,
            item.price,
            encryptText(item.warehouseLocation.zone, warehouseId),
            encryptText(item.warehouseLocation.aisle, warehouseId),
            encryptText(item.warehouseLocation.shelf, warehouseId),
            encryptText(item.warehouseLocation.bin, warehouseId),
            itemSupId,
            item.minThreshold,
            item.lastUpdated,
            encryptText(item.notes || '', warehouseId)
          ]
        );
      }
    }

    // Transactions
    const txCheck = await pool.query('SELECT COUNT(*) FROM transactions WHERE warehouse_id = $1', [warehouseId]);
    if (parseInt(txCheck.rows[0].count, 10) === 0) {
      console.log(`Seeding transactions for warehouse ${warehouseId}...`);
      for (const tx of INITIAL_TRANSACTIONS) {
        await pool.query(
          `INSERT INTO transactions (id, warehouse_id, item_id, item_name, sku, type, quantity, reason, timestamp, operator) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING`,
          [
            `${tx.id}-${warehouseId}`,
            warehouseId,
            `${tx.itemId}-${warehouseId}`,
            encryptText(tx.itemName, warehouseId),
            encryptText(tx.sku, warehouseId),
            tx.type,
            tx.quantity,
            encryptText(tx.reason, warehouseId),
            tx.timestamp,
            encryptText(tx.operator, warehouseId)
          ]
        );
      }
    }
  } else {
    // In-Memory fallback seeding
    // Categories
    if (memCategories.filter(c => c.warehouse_id === warehouseId).length === 0) {
      INITIAL_CATEGORIES.forEach(cat => {
        memCategories.push({
          id: `${cat.id}-${warehouseId}`,
          warehouse_id: warehouseId,
          name: encryptText(cat.name, warehouseId),
          description: encryptText(cat.description, warehouseId),
          color: encryptText(cat.color, warehouseId)
        });
      });
    }

    // Suppliers
    if (memSuppliers.filter(s => s.warehouse_id === warehouseId).length === 0) {
      INITIAL_SUPPLIERS.forEach(s => {
        memSuppliers.push({
          id: `${s.id}-${warehouseId}`,
          warehouse_id: warehouseId,
          name: encryptText(s.name, warehouseId),
          contactName: encryptText(s.contactName, warehouseId),
          email: encryptText(s.email, warehouseId),
          phone: encryptText(s.phone, warehouseId),
          address: encryptText(s.address, warehouseId)
        });
      });
    }

    // Zones
    if (memZones.filter(z => z.warehouse_id === warehouseId).length === 0) {
      INITIAL_ZONES.forEach(z => {
        memZones.push({
          id: `${z.id}-${warehouseId}`,
          warehouse_id: warehouseId,
          name: encryptText(z.name, warehouseId),
          description: encryptText(z.description, warehouseId),
          maxCapacity: z.maxCapacity,
          color: encryptText(z.color, warehouseId)
        });
      });
    }

    // Items
    if (memItems.filter(i => i.warehouse_id === warehouseId).length === 0) {
      INITIAL_ITEMS.forEach(item => {
        memItems.push({
          id: `${item.id}-${warehouseId}`,
          warehouse_id: warehouseId,
          name: encryptText(item.name, warehouseId),
          sku: encryptText(item.sku, warehouseId),
          category: encryptText(item.category, warehouseId),
          quantity: item.quantity,
          unit: item.unit,
          price: item.price,
          warehouseLocation: {
            zone: encryptText(item.warehouseLocation.zone, warehouseId),
            aisle: encryptText(item.warehouseLocation.aisle, warehouseId),
            shelf: encryptText(item.warehouseLocation.shelf, warehouseId),
            bin: encryptText(item.warehouseLocation.bin, warehouseId)
          },
          supplierId: item.supplierId ? `${item.supplierId}-${warehouseId}` : undefined,
          minThreshold: item.minThreshold,
          lastUpdated: item.lastUpdated,
          notes: encryptText(item.notes || '', warehouseId)
        });
      });
    }

    // Transactions
    if (memTransactions.filter(t => t.warehouse_id === warehouseId).length === 0) {
      INITIAL_TRANSACTIONS.forEach(tx => {
        memTransactions.push({
          id: `${tx.id}-${warehouseId}`,
          warehouse_id: warehouseId,
          itemId: `${tx.itemId}-${warehouseId}`,
          itemName: encryptText(tx.itemName, warehouseId),
          sku: encryptText(tx.sku, warehouseId),
          type: tx.type,
          quantity: tx.quantity,
          reason: encryptText(tx.reason, warehouseId),
          timestamp: tx.timestamp,
          operator: encryptText(tx.operator, warehouseId)
        });
      });
    }
  }
}

// --- User Management ---
export async function createUser(user: { id: string, email: string, passwordHash?: string, name: string, warehouseId: string, provider: string, providerId?: string, tokenVersion?: number }) {
  const tokenVersion = user.tokenVersion || 1;
  if (usePostgres) {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, name, warehouse_id, provider, provider_id, token_version) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [user.id, user.email, user.passwordHash || null, user.name, user.warehouseId, user.provider, user.providerId || null, tokenVersion]
    );
  } else {
    memUsers.push({
      ...user,
      tokenVersion,
      createdAt: new Date().toISOString()
    });
  }
  return user;
}

export async function findUserByEmail(email: string) {
  const normEmail = normalizeInvitationEmail(email);
  if (usePostgres) {
    const res = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [normEmail]);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      name: row.name,
      warehouseId: row.warehouse_id,
      provider: row.provider,
      providerId: row.provider_id,
      tokenVersion: row.token_version || 1
    };
  } else {
    const matched = memUsers.find(u => u.normalizeInvitationEmail(email) === normEmail);
    return matched ? { ...matched, tokenVersion: matched.tokenVersion || 1 } : null;
  }
}

export async function findUserById(id: string) {
  if (usePostgres) {
    const res = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      name: row.name,
      warehouseId: row.warehouse_id,
      provider: row.provider,
      providerId: row.provider_id,
      tokenVersion: row.token_version || 1
    };
  } else {
    const matched = memUsers.find(u => u.id === id);
    return matched ? { ...matched, tokenVersion: matched.tokenVersion || 1 } : null;
  }
}

export async function findUserByOAuth(provider: string, providerId: string) {
  if (usePostgres) {
    const res = await pool.query('SELECT * FROM users WHERE provider = $1 AND provider_id = $2', [provider, providerId]);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      name: row.name,
      warehouseId: row.warehouse_id,
      provider: row.provider,
      providerId: row.provider_id,
      tokenVersion: row.token_version || 1
    };
  } else {
    const matched = memUsers.find(u => u.provider === provider && u.providerId === providerId);
    return matched ? { ...matched, tokenVersion: matched.tokenVersion || 1 } : null;
  }
}

export async function changeUserPassword(userId: string, currentPass: string, newPass: string, warehouseId: string, ipAddress?: string) {
  const user = await findUserById(userId);
  if (!user) {
    throw new Error('User account not found.');
  }

  if (user.passwordHash) {
    const isMatch = await bcrypt.compare(currentPass, user.passwordHash);
    if (!isMatch) {
      await logSystemAudit({
        warehouseId,
        action: 'PASSWORD_CHANGE_FAILED',
        category: 'SECURITY',
        details: `Failed password change attempt for user ${user.email} (invalid current credentials).`,
        operator: user.name || user.email,
        operatorId: userId,
        ipAddress,
        status: 'FAILED'
      });
      throw new Error('Incorrect current password.');
    }
  }

  if (!newPass || newPass.length < 6) {
    throw new Error('New password must be at least 6 characters long.');
  }

  const newHash = await bcrypt.hash(newPass, 10);
  const nextTokenVersion = (user.tokenVersion || 1) + 1;

  if (usePostgres) {
    await pool.query('UPDATE users SET password_hash = $1, token_version = $2 WHERE id = $3', [newHash, nextTokenVersion, userId]);
  } else {
    const idx = memUsers.findIndex(u => u.id === userId);
    if (idx !== -1) {
      memUsers[idx].passwordHash = newHash;
      memUsers[idx].tokenVersion = nextTokenVersion;
    }
  }

  await logSystemAudit({
    warehouseId,
    action: 'PASSWORD_CHANGED',
    category: 'SECURITY',
    details: `Password changed and prior active sessions rotated/invalidated for ${user.email}.`,
    operator: user.name || user.email,
    operatorId: userId,
    ipAddress,
    status: 'SUCCESS'
  });

  return { success: true, tokenVersion: nextTokenVersion };
}

// --- Warehouse Management ---
export async function createWarehouse(warehouse: { 
  id: string, 
  name: string, 
  code: string, 
  address?: string,
  email?: string,
  phone?: string,
  contact_name?: string,
  layout_rows?: number,
  layout_cols?: number,
  layout_zones?: string
}) {
  if (usePostgres) {
    await pool.query(
      `INSERT INTO warehouses (id, name, code, address, email, phone, contact_name, layout_rows, layout_cols, layout_zones) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        warehouse.id, 
        warehouse.name, 
        warehouse.code, 
        warehouse.address || null,
        warehouse.email || null,
        warehouse.phone || null,
        warehouse.contact_name || null,
        warehouse.layout_rows ?? 5,
        warehouse.layout_cols ?? 5,
        warehouse.layout_zones || '[]'
      ]
    );
  } else {
    memWarehouses.push({
      ...warehouse,
      layout_rows: warehouse.layout_rows ?? 5,
      layout_cols: warehouse.layout_cols ?? 5,
      layout_zones: warehouse.layout_zones || '[]',
      createdAt: new Date().toISOString()
    });
  }
  return warehouse;
}

export async function findWarehouseByCode(code: string) {
  const normCode = code.toUpperCase().trim();
  if (usePostgres) {
    const res = await pool.query('SELECT * FROM warehouses WHERE UPPER(code) = $1', [normCode]);
    if (res.rows.length === 0) return null;
    return res.rows[0];
  } else {
    const matched = memWarehouses.find(w => w.code.toUpperCase().trim() === normCode);
    return matched ? { ...matched } : null;
  }
}

export async function findWarehouseById(id: string) {
  if (usePostgres) {
    const res = await pool.query('SELECT * FROM warehouses WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return res.rows[0];
  } else {
    const matched = memWarehouses.find(w => w.id === id);
    return matched ? { ...matched } : null;
  }
}

// --- Tenant Scoped Data Queries ---

export async function getCategories(warehouseId: string) {
  let list = [];
  if (usePostgres) {
    const res = await pool.query('SELECT * FROM categories WHERE warehouse_id = $1', [warehouseId]);
    list = res.rows;
  } else {
    list = memCategories.filter(c => c.warehouse_id === warehouseId);
  }
  return list.map((row: any) => ({
    id: row.id,
    name: decryptText(row.name, warehouseId),
    description: decryptText(row.description, warehouseId),
    color: decryptText(row.color, warehouseId),
  }));
}

export async function saveCategory(category: any, warehouseId: string) {
  if (usePostgres) {
    await pool.query(
      `INSERT INTO categories (id, warehouse_id, name, description, color)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         name = $3,
         description = $4,
         color = $5`,
      [
        category.id,
        warehouseId,
        encryptText(category.name, warehouseId),
        encryptText(category.description || '', warehouseId),
        encryptText(category.color || '', warehouseId)
      ]
    );
  } else {
    const idx = memCategories.findIndex(c => c.id === category.id);
    const mapped = {
      id: category.id,
      warehouse_id: warehouseId,
      name: encryptText(category.name, warehouseId),
      description: encryptText(category.description || '', warehouseId),
      color: encryptText(category.color || '', warehouseId)
    };
    if (idx >= 0) {
      memCategories[idx] = mapped;
    } else {
      memCategories.push(mapped);
    }
  }
}

export async function deleteCategory(id: string, warehouseId: string) {
  if (usePostgres) {
    await pool.query('DELETE FROM categories WHERE id = $1 AND warehouse_id = $2', [id, warehouseId]);
  } else {
    memCategories = memCategories.filter(c => !(c.id === id && c.warehouse_id === warehouseId));
  }
}

export async function getSuppliers(warehouseId: string) {
  let list = [];
  if (usePostgres) {
    const res = await pool.query('SELECT * FROM suppliers WHERE warehouse_id = $1', [warehouseId]);
    list = res.rows;
  } else {
    list = memSuppliers.filter(s => s.warehouse_id === warehouseId);
  }
  return list.map((row: any) => ({
    id: row.id,
    name: decryptText(row.name, warehouseId),
    contactName: decryptText(row.contact_name || row.contactName, warehouseId),
    email: decryptText(row.email, warehouseId),
    phone: decryptText(row.phone, warehouseId),
    address: decryptText(row.address, warehouseId),
  }));
}

export async function saveSupplier(supplier: any, warehouseId: string) {
  if (usePostgres) {
    await pool.query(
      `INSERT INTO suppliers (id, warehouse_id, name, contact_name, email, phone, address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         name = $3,
         contact_name = $4,
         email = $5,
         phone = $6,
         address = $7`,
      [
        supplier.id,
        warehouseId,
        encryptText(supplier.name, warehouseId),
        encryptText(supplier.contactName, warehouseId),
        encryptText(supplier.email, warehouseId),
        encryptText(supplier.phone, warehouseId),
        encryptText(supplier.address, warehouseId)
      ]
    );
  } else {
    const idx = memSuppliers.findIndex(s => s.id === supplier.id);
    const mapped = {
      id: supplier.id,
      warehouse_id: warehouseId,
      name: encryptText(supplier.name, warehouseId),
      contact_name: encryptText(supplier.contactName, warehouseId),
      email: encryptText(supplier.email, warehouseId),
      phone: encryptText(supplier.phone, warehouseId),
      address: encryptText(supplier.address, warehouseId)
    };
    if (idx >= 0) {
      memSuppliers[idx] = mapped;
    } else {
      memSuppliers.push(mapped);
    }
  }
}

export async function getZones(warehouseId: string) {
  let list = [];
  if (usePostgres) {
    const res = await pool.query('SELECT * FROM zones WHERE warehouse_id = $1', [warehouseId]);
    list = res.rows;
  } else {
    list = memZones.filter(z => z.warehouse_id === warehouseId);
  }
  return list.map((row: any) => ({
    id: row.id,
    name: decryptText(row.name, warehouseId),
    description: decryptText(row.description, warehouseId),
    maxCapacity: row.max_capacity || row.maxCapacity,
    color: decryptText(row.color, warehouseId),
  }));
}

export async function saveZone(zone: any, warehouseId: string) {
  if (usePostgres) {
    await pool.query(
      `INSERT INTO zones (id, warehouse_id, name, description, max_capacity, color)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         name = $3,
         description = $4,
         max_capacity = $5,
         color = $6`,
      [
        zone.id,
        warehouseId,
        encryptText(zone.name, warehouseId),
        encryptText(zone.description, warehouseId),
        zone.maxCapacity,
        encryptText(zone.color, warehouseId)
      ]
    );
  } else {
    const idx = memZones.findIndex(z => z.id === zone.id);
    const mapped = {
      id: zone.id,
      warehouse_id: warehouseId,
      name: encryptText(zone.name, warehouseId),
      description: encryptText(zone.description, warehouseId),
      max_capacity: zone.maxCapacity,
      color: encryptText(zone.color, warehouseId)
    };
    if (idx >= 0) {
      memZones[idx] = mapped;
    } else {
      memZones.push(mapped);
    }
  }
}

export async function deleteZone(id: string, warehouseId: string) {
  if (usePostgres) {
    await pool.query('DELETE FROM zones WHERE id = $1 AND warehouse_id = $2', [id, warehouseId]);
  } else {
    memZones = memZones.filter(z => !(z.id === id && z.warehouse_id === warehouseId));
  }
}

export async function getItems(warehouseId: string) {
  let list = [];
  if (usePostgres) {
    const res = await pool.query('SELECT * FROM items WHERE warehouse_id = $1 ORDER BY last_updated DESC', [warehouseId]);
    list = res.rows;
  } else {
    list = memItems.filter(i => i.warehouse_id === warehouseId);
  }
  return list.map((row: any) => ({
    id: row.id,
    name: decryptText(row.name, warehouseId),
    sku: decryptText(row.sku, warehouseId),
    category: decryptText(row.category, warehouseId),
    quantity: row.quantity,
    unit: row.unit,
    price: parseFloat(row.price),
    warehouseLocation: {
      zone: decryptText(row.zone || (row.warehouseLocation && row.warehouseLocation.zone), warehouseId),
      aisle: decryptText(row.aisle || (row.warehouseLocation && row.warehouseLocation.aisle), warehouseId),
      shelf: decryptText(row.shelf || (row.warehouseLocation && row.warehouseLocation.shelf), warehouseId),
      bin: decryptText(row.bin || (row.warehouseLocation && row.warehouseLocation.bin), warehouseId),
    },
    supplierId: row.supplier_id || row.supplierId,
    minThreshold: row.min_threshold || row.minThreshold,
    lastUpdated: (row.last_updated ? (typeof row.last_updated === 'string' ? row.last_updated : row.last_updated.toISOString()) : (row.lastUpdated || new Date().toISOString())),
    notes: decryptText(row.notes, warehouseId),
    isArchived: !!(row.is_archived || row.isArchived),
    batchNumber: decryptText(row.batch_number || row.batchNumber, warehouseId),
    expiryDate: decryptText(row.expiry_date || row.expiryDate, warehouseId),
  }));
}

export async function getTransactions(warehouseId: string) {
  let list = [];
  if (usePostgres) {
    const res = await pool.query('SELECT * FROM transactions WHERE warehouse_id = $1 ORDER BY timestamp DESC', [warehouseId]);
    list = res.rows;
  } else {
    list = memTransactions.filter(t => t.warehouse_id === warehouseId);
  }
  return list.map((row: any) => ({
    id: row.id,
    itemId: row.item_id || row.itemId,
    itemName: decryptText(row.item_name || row.itemName, warehouseId),
    sku: decryptText(row.sku, warehouseId),
    type: row.type,
    quantity: row.quantity,
    reason: decryptText(row.reason, warehouseId),
    timestamp: (row.timestamp ? (typeof row.timestamp === 'string' ? row.timestamp : row.timestamp.toISOString()) : (row.timestamp || new Date().toISOString())),
    operator: decryptText(row.operator, warehouseId),
    batchNumber: decryptText(row.batch_number || row.batchNumber, warehouseId),
    sourceWarehouseId: row.source_warehouse_id || row.sourceWarehouseId,
    destWarehouseId: row.dest_warehouse_id || row.destWarehouseId,
  }));
}

export async function saveItem(item: any, warehouseId: string) {
  const encName = encryptText(item.name, warehouseId);
  const encSku = encryptText(item.sku, warehouseId);
  const encCategory = encryptText(item.category, warehouseId);
  const encZone = encryptText(item.warehouseLocation.zone, warehouseId);
  const encAisle = encryptText(item.warehouseLocation.aisle, warehouseId);
  const encShelf = encryptText(item.warehouseLocation.shelf, warehouseId);
  const encBin = encryptText(item.warehouseLocation.bin, warehouseId);
  const encNotes = encryptText(item.notes || '', warehouseId);
  const encBatch = encryptText(item.batchNumber || '', warehouseId);
  const encExpiry = encryptText(item.expiryDate || '', warehouseId);
  const isArchived = !!item.isArchived;

  if (usePostgres) {
    await pool.query(
      `INSERT INTO items (id, warehouse_id, name, sku, category, quantity, unit, price, zone, aisle, shelf, bin, supplier_id, min_threshold, last_updated, notes, is_archived, batch_number, expiry_date) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        item.id,
        warehouseId,
        encName,
        encSku,
        encCategory,
        item.quantity,
        item.unit,
        item.price,
        encZone,
        encAisle,
        encShelf,
        encBin,
        item.supplierId || null,
        item.minThreshold,
        item.lastUpdated,
        encNotes,
        isArchived,
        encBatch,
        encExpiry
      ]
    );
  } else {
    memItems.unshift({
      ...item,
      warehouse_id: warehouseId,
      name: encName,
      sku: encSku,
      category: encCategory,
      warehouseLocation: {
        zone: encZone,
        aisle: encAisle,
        shelf: encShelf,
        bin: encBin
      },
      notes: encNotes,
      is_archived: isArchived,
      batch_number: encBatch,
      expiry_date: encExpiry
    });
  }
}

export async function updateItem(id: string, item: any, warehouseId: string) {
  const encName = encryptText(item.name, warehouseId);
  const encSku = encryptText(item.sku, warehouseId);
  const encCategory = encryptText(item.category, warehouseId);
  const encZone = encryptText(item.warehouseLocation.zone, warehouseId);
  const encAisle = encryptText(item.warehouseLocation.aisle, warehouseId);
  const encShelf = encryptText(item.warehouseLocation.shelf, warehouseId);
  const encBin = encryptText(item.warehouseLocation.bin, warehouseId);
  const encNotes = encryptText(item.notes || '', warehouseId);
  const encBatch = encryptText(item.batchNumber || '', warehouseId);
  const encExpiry = encryptText(item.expiryDate || '', warehouseId);
  const isArchived = !!item.isArchived;

  if (usePostgres) {
    await pool.query(
      `UPDATE items SET 
        name = $1, 
        sku = $2, 
        category = $3, 
        quantity = $4, 
        unit = $5, 
        price = $6, 
        zone = $7, 
        aisle = $8, 
        shelf = $9, 
        bin = $10, 
        supplier_id = $11, 
        min_threshold = $12, 
        last_updated = $13, 
        notes = $14,
        is_archived = $15,
        batch_number = $16,
        expiry_date = $17
       WHERE id = $18 AND warehouse_id = $19`,
      [
        encName,
        encSku,
        encCategory,
        item.quantity,
        item.unit,
        item.price,
        encZone,
        encAisle,
        encShelf,
        encBin,
        item.supplierId || null,
        item.minThreshold,
        item.lastUpdated,
        encNotes,
        isArchived,
        encBatch,
        encExpiry,
        id,
        warehouseId
      ]
    );
  } else {
    memItems = memItems.map(i => (i.id === id && i.warehouse_id === warehouseId) ? { 
      ...i, 
      ...item,
      name: encName,
      sku: encSku,
      category: encCategory,
      warehouseLocation: {
        zone: encZone,
        aisle: encAisle,
        shelf: encShelf,
        bin: encBin
      },
      notes: encNotes,
      is_archived: isArchived,
      batch_number: encBatch,
      expiry_date: encExpiry
    } : i);
  }
}

export async function archiveItem(id: string, warehouseId: string, isArchived: boolean = true) {
  if (usePostgres) {
    await pool.query('UPDATE items SET is_archived = $1 WHERE id = $2 AND warehouse_id = $3', [isArchived, id, warehouseId]);
  } else {
    memItems = memItems.map(i => (i.id === id && i.warehouse_id === warehouseId) ? { ...i, is_archived: isArchived } : i);
  }
  const items = await getItems(warehouseId);
  return items.find((i: any) => i.id === id);
}

export async function deleteItem(id: string, warehouseId: string) {
  if (usePostgres) {
    await pool.query('DELETE FROM items WHERE id = $1 AND warehouse_id = $2', [id, warehouseId]);
  } else {
    memItems = memItems.filter(i => !(i.id === id && i.warehouse_id === warehouseId));
  }
}

export async function saveTransaction(tx: any, warehouseId: string) {
  const encItemName = encryptText(tx.itemName, warehouseId);
  const encSku = encryptText(tx.sku, warehouseId);
  const encReason = encryptText(tx.reason, warehouseId);
  const encOperator = encryptText(tx.operator, warehouseId);
  const encBatch = encryptText(tx.batchNumber || '', warehouseId);

  if (usePostgres) {
    await pool.query(
      `INSERT INTO transactions (id, warehouse_id, item_id, item_name, sku, type, quantity, reason, timestamp, operator, batch_number, source_warehouse_id, dest_warehouse_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        tx.id,
        warehouseId,
        tx.itemId,
        encItemName,
        encSku,
        tx.type,
        tx.quantity,
        encReason,
        tx.timestamp,
        encOperator,
        encBatch,
        tx.sourceWarehouseId || null,
        tx.destWarehouseId || null
      ]
    );
  } else {
    memTransactions.unshift({
      ...tx,
      warehouse_id: warehouseId,
      itemName: encItemName,
      sku: encSku,
      reason: encReason,
      operator: encOperator,
      batch_number: encBatch,
      source_warehouse_id: tx.sourceWarehouseId || null,
      dest_warehouse_id: tx.destWarehouseId || null
    });
  }
}

// --- Atomic Inventory Adjustments with Rollback and Locking ---
export async function adjustStockAtomic(
  warehouseId: string,
  itemId: string,
  type: 'INBOUND' | 'OUTBOUND',
  quantityChange: number,
  reason: string,
  operator: string,
  batchNumber?: string
) {
  if (quantityChange <= 0) {
    throw new Error('Quantity must be greater than 0.');
  }

  if (usePostgres) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Select item with pessimistic locking
      const itemRes = await client.query(
        'SELECT * FROM items WHERE id = $1 AND warehouse_id = $2 FOR UPDATE',
        [itemId, warehouseId]
      );

      if (itemRes.rows.length === 0) {
        throw new Error('Item not found in this warehouse.');
      }

      const row = itemRes.rows[0];
      const currentQty = row.quantity;
      let newQty = currentQty;

      if (type === 'INBOUND') {
        newQty = currentQty + quantityChange;
      } else {
        if (currentQty < quantityChange) {
          throw new Error(`Insufficient stock. Current inventory is ${currentQty} units.`);
        }
        newQty = currentQty - quantityChange;
      }

      const now = new Date().toISOString();
      const encBatch = batchNumber ? encryptText(batchNumber, warehouseId) : row.batch_number;

      // Update item quantity
      await client.query(
        `UPDATE items SET quantity = $1, last_updated = $2, batch_number = COALESCE($3, batch_number) WHERE id = $4 AND warehouse_id = $5`,
        [newQty, now, encBatch, itemId, warehouseId]
      );

      // Create transaction log
      const txId = `tx-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      await client.query(
        `INSERT INTO transactions (id, warehouse_id, item_id, item_name, sku, type, quantity, reason, timestamp, operator, batch_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          txId,
          warehouseId,
          itemId,
          row.name,
          row.sku,
          type,
          quantityChange,
          encryptText(reason, warehouseId),
          now,
          encryptText(operator, warehouseId),
          encBatch
        ]
      );

      await client.query('COMMIT');
      const itemsList = await getItems(warehouseId);
      const updatedItem = itemsList.find((i: any) => i.id === itemId);
      const txObj = {
        id: txId,
        itemId,
        itemName: decryptText(row.name, warehouseId),
        sku: decryptText(row.sku, warehouseId),
        type,
        quantity: quantityChange,
        reason,
        timestamp: now,
        operator,
        batchNumber: batchNumber || (row.batch_number ? decryptText(row.batch_number, warehouseId) : undefined)
      };
      return { success: true, itemId, newQuantity: newQty, txId, item: updatedItem, transaction: txObj };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    // In-memory atomic adjustment
    const itemIndex = memItems.findIndex(i => i.id === itemId && i.warehouse_id === warehouseId);
    if (itemIndex === -1) {
      throw new Error('Item not found in this warehouse.');
    }

    const item = memItems[itemIndex];
    let newQty = item.quantity;

    if (type === 'INBOUND') {
      newQty = item.quantity + quantityChange;
    } else {
      if (item.quantity < quantityChange) {
        throw new Error(`Insufficient stock. Current inventory is ${item.quantity} units.`);
      }
      newQty = item.quantity - quantityChange;
    }

    const now = new Date().toISOString();
    memItems[itemIndex].quantity = newQty;
    memItems[itemIndex].lastUpdated = now;
    if (batchNumber) {
      memItems[itemIndex].batch_number = encryptText(batchNumber, warehouseId);
    }

    const txId = `tx-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const txEntry = {
      id: txId,
      warehouse_id: warehouseId,
      itemId,
      itemName: item.name,
      sku: item.sku,
      type,
      quantity: quantityChange,
      reason: encryptText(reason, warehouseId),
      timestamp: now,
      operator: encryptText(operator, warehouseId),
      batch_number: batchNumber ? encryptText(batchNumber, warehouseId) : item.batch_number
    };
    memTransactions.unshift(txEntry);

    const updatedItem = {
      ...item,
      name: decryptText(item.name, warehouseId),
      sku: decryptText(item.sku, warehouseId),
      category: decryptText(item.category, warehouseId),
      quantity: newQty,
      lastUpdated: now
    };

    const txObj = {
      id: txId,
      itemId,
      itemName: decryptText(item.name, warehouseId),
      sku: decryptText(item.sku, warehouseId),
      type,
      quantity: quantityChange,
      reason,
      timestamp: now,
      operator,
      batchNumber: batchNumber || (item.batch_number ? decryptText(item.batch_number, warehouseId) : undefined)
    };

    return { success: true, itemId, newQuantity: newQty, txId, item: updatedItem, transaction: txObj };
  }
}

// --- Atomic Multi-Item Restock ---
export async function restockAtomic(warehouseId: string, itemsToRestock: any[], operator: string, supplierId?: string) {
  if (usePostgres) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const now = new Date().toISOString();
      const updatedItems: any[] = [];
      const newTransactions: any[] = [];

      for (const item of itemsToRestock) {
        const qtyToAdd = item.qty || item.reorderQty || 0;
        if (qtyToAdd <= 0) continue;

        const itemRes = await client.query(
          'SELECT * FROM items WHERE id = $1 AND warehouse_id = $2 FOR UPDATE',
          [item.id, warehouseId]
        );
        if (itemRes.rows.length === 0) continue;

        const row = itemRes.rows[0];
        const newQty = row.quantity + qtyToAdd;
        const txId = `tx-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

        await client.query(
          'UPDATE items SET quantity = $1, last_updated = $2 WHERE id = $3 AND warehouse_id = $4',
          [newQty, now, item.id, warehouseId]
        );

        const reason = `Automated Restock Order Received${supplierId ? ` (Supplier: ${supplierId})` : ''}`;
        await client.query(
          `INSERT INTO transactions (id, warehouse_id, item_id, item_name, sku, type, quantity, reason, timestamp, operator)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            txId,
            warehouseId,
            item.id,
            row.name,
            row.sku,
            'INBOUND',
            qtyToAdd,
            encryptText(reason, warehouseId),
            now,
            encryptText(operator, warehouseId)
          ]
        );

        newTransactions.push({
          id: txId,
          itemId: item.id,
          itemName: decryptText(row.name, warehouseId),
          sku: decryptText(row.sku, warehouseId),
          type: 'INBOUND',
          quantity: qtyToAdd,
          reason,
          timestamp: now,
          operator
        });
      }

      await client.query('COMMIT');
      const allItems = await getItems(warehouseId);
      const affectedIds = new Set(itemsToRestock.map(i => i.id));
      const resUpdatedItems = allItems.filter((i: any) => affectedIds.has(i.id));

      return { success: true, updatedItems: resUpdatedItems, newTransactions };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    const now = new Date().toISOString();
    const updatedItems: any[] = [];
    const newTransactions: any[] = [];

    itemsToRestock.forEach(item => {
      const qtyToAdd = item.qty || item.reorderQty || 0;
      if (qtyToAdd <= 0) return;

      const idx = memItems.findIndex(i => i.id === item.id && i.warehouse_id === warehouseId);
      if (idx !== -1) {
        memItems[idx].quantity += qtyToAdd;
        memItems[idx].lastUpdated = now;

        const txId = `tx-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        const reason = `Automated Restock Order Received${supplierId ? ` (Supplier: ${supplierId})` : ''}`;
        
        memTransactions.unshift({
          id: txId,
          warehouse_id: warehouseId,
          itemId: item.id,
          itemName: memItems[idx].name,
          sku: memItems[idx].sku,
          type: 'INBOUND',
          quantity: qtyToAdd,
          reason: encryptText(reason, warehouseId),
          timestamp: now,
          operator: encryptText(operator, warehouseId)
        });

        updatedItems.push({
          ...memItems[idx],
          name: decryptText(memItems[idx].name, warehouseId),
          sku: decryptText(memItems[idx].sku, warehouseId)
        });

        newTransactions.push({
          id: txId,
          itemId: item.id,
          itemName: decryptText(memItems[idx].name, warehouseId),
          sku: decryptText(memItems[idx].sku, warehouseId),
          type: 'INBOUND',
          quantity: qtyToAdd,
          reason,
          timestamp: now,
          operator
        });
      }
    });
    return { success: true, updatedItems, newTransactions };
  }
}

// --- Atomic Inter-Warehouse Stock Transfer ---
export async function transferStockAtomic(params: {
  userId?: string;
  sourceWarehouseId: string;
  destWarehouseId: string;
  itemId: string;
  quantity: number;
  operator: string;
  reason?: string;
  notes?: string;
  batchNumber?: string;
}) {
  const { userId, sourceWarehouseId, destWarehouseId, itemId, quantity, operator, reason, batchNumber } = params;

  if (sourceWarehouseId === destWarehouseId) {
    throw new Error('Source and destination warehouse cannot be the same.');
  }
  if (quantity <= 0) {
    throw new Error('Transfer quantity must be greater than 0.');
  }

  // If userId provided, verify user has access to source warehouse
  if (userId) {
    const hasSource = await isUserInWarehouse(userId, sourceWarehouseId);
    if (!hasSource) {
      throw new Error('You do not have authorization for the source warehouse.');
    }
  }

  const transferReason = reason || `Inter-Warehouse Transfer: from ${sourceWarehouseId} to ${destWarehouseId}`;
  const now = new Date().toISOString();

  if (usePostgres) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock source item
      const srcRes = await client.query(
        'SELECT * FROM items WHERE id = $1 AND warehouse_id = $2 FOR UPDATE',
        [itemId, sourceWarehouseId]
      );
      if (srcRes.rows.length === 0) {
        throw new Error('Source item not found.');
      }
      const srcRow = srcRes.rows[0];
      if (srcRow.quantity < quantity) {
        throw new Error(`Insufficient stock in source warehouse. Current stock is ${srcRow.quantity}.`);
      }

      // 2. Decrement source item
      const srcNewQty = srcRow.quantity - quantity;
      await client.query(
        'UPDATE items SET quantity = $1, last_updated = $2 WHERE id = $3 AND warehouse_id = $4',
        [srcNewQty, now, itemId, sourceWarehouseId]
      );

      // 3. Log source TRANSFER_OUT
      const srcTxId = `tx-out-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      await client.query(
        `INSERT INTO transactions (id, warehouse_id, item_id, item_name, sku, type, quantity, reason, timestamp, operator, batch_number, source_warehouse_id, dest_warehouse_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          srcTxId,
          sourceWarehouseId,
          itemId,
          srcRow.name,
          srcRow.sku,
          'TRANSFER_OUT',
          quantity,
          encryptText(transferReason, sourceWarehouseId),
          now,
          encryptText(operator, sourceWarehouseId),
          batchNumber ? encryptText(batchNumber, sourceWarehouseId) : srcRow.batch_number,
          sourceWarehouseId,
          destWarehouseId
        ]
      );

      // 4. Decrypt SKU/Name from source to find or match in destination warehouse
      const decSku = decryptText(srcRow.sku, sourceWarehouseId);
      const decName = decryptText(srcRow.name, sourceWarehouseId);
      const decCat = decryptText(srcRow.category, sourceWarehouseId);
      const decZone = decryptText(srcRow.zone, sourceWarehouseId);
      const decAisle = decryptText(srcRow.aisle, sourceWarehouseId);
      const decShelf = decryptText(srcRow.shelf, sourceWarehouseId);
      const decBin = decryptText(srcRow.bin, sourceWarehouseId);

      // Check destination warehouse for item with matching SKU
      const destItems = await getItems(destWarehouseId);
      const existingDestItem = destItems.find((i: any) => i.sku.toLowerCase() === decSku.toLowerCase());

      let destItemId = '';
      if (existingDestItem) {
        destItemId = existingDestItem.id;
        const destNewQty = existingDestItem.quantity + quantity;
        await client.query(
          'UPDATE items SET quantity = $1, last_updated = $2 WHERE id = $3 AND warehouse_id = $4',
          [destNewQty, now, destItemId, destWarehouseId]
        );
      } else {
        destItemId = `item-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        await client.query(
          `INSERT INTO items (id, warehouse_id, name, sku, category, quantity, unit, price, zone, aisle, shelf, bin, min_threshold, last_updated, notes, is_archived, batch_number, expiry_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
          [
            destItemId,
            destWarehouseId,
            encryptText(decName, destWarehouseId),
            encryptText(decSku, destWarehouseId),
            encryptText(decCat, destWarehouseId),
            quantity,
            srcRow.unit,
            srcRow.price,
            encryptText(decZone, destWarehouseId),
            encryptText(decAisle, destWarehouseId),
            encryptText(decShelf, destWarehouseId),
            encryptText(decBin, destWarehouseId),
            srcRow.min_threshold,
            now,
            encryptText(`Transferred from ${sourceWarehouseId}`, destWarehouseId),
            false,
            batchNumber ? encryptText(batchNumber, destWarehouseId) : null,
            srcRow.expiry_date ? encryptText(decryptText(srcRow.expiry_date, sourceWarehouseId), destWarehouseId) : null
          ]
        );
      }

      // 5. Log destination TRANSFER_IN
      const destTxId = `tx-in-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      await client.query(
        `INSERT INTO transactions (id, warehouse_id, item_id, item_name, sku, type, quantity, reason, timestamp, operator, batch_number, source_warehouse_id, dest_warehouse_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          destTxId,
          destWarehouseId,
          destItemId,
          encryptText(decName, destWarehouseId),
          encryptText(decSku, destWarehouseId),
          'TRANSFER_IN',
          quantity,
          encryptText(transferReason, destWarehouseId),
          now,
          encryptText(operator, destWarehouseId),
          batchNumber ? encryptText(batchNumber, destWarehouseId) : null,
          sourceWarehouseId,
          destWarehouseId
        ]
      );

      await client.query('COMMIT');
      return { success: true, sourceTxId: srcTxId, destTxId: destTxId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    // In-memory atomic transfer
    const srcIndex = memItems.findIndex(i => i.id === itemId && i.warehouse_id === sourceWarehouseId);
    if (srcIndex === -1) {
      throw new Error('Source item not found.');
    }
    const srcItem = memItems[srcIndex];
    if (srcItem.quantity < quantity) {
      throw new Error(`Insufficient stock in source warehouse. Current stock is ${srcItem.quantity}.`);
    }

    // Decrement source item
    srcItem.quantity -= quantity;
    srcItem.lastUpdated = now;

    // Log source transfer out
    const srcTxId = `tx-out-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    memTransactions.unshift({
      id: srcTxId,
      warehouse_id: sourceWarehouseId,
      itemId,
      itemName: srcItem.name,
      sku: srcItem.sku,
      type: 'TRANSFER_OUT',
      quantity,
      reason: encryptText(transferReason, sourceWarehouseId),
      timestamp: now,
      operator: encryptText(operator, sourceWarehouseId),
      batch_number: batchNumber ? encryptText(batchNumber, sourceWarehouseId) : srcItem.batch_number,
      source_warehouse_id: sourceWarehouseId,
      dest_warehouse_id: destWarehouseId
    });

    const decSku = decryptText(srcItem.sku, sourceWarehouseId);
    const decName = decryptText(srcItem.name, sourceWarehouseId);

    // Look for item in dest warehouse
    const destIndex = memItems.findIndex(i => i.warehouse_id === destWarehouseId && decryptText(i.sku, destWarehouseId).toLowerCase() === decSku.toLowerCase());
    let destItemId = '';
    if (destIndex !== -1) {
      memItems[destIndex].quantity += quantity;
      memItems[destIndex].lastUpdated = now;
      destItemId = memItems[destIndex].id;
    } else {
      destItemId = `item-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      memItems.unshift({
        id: destItemId,
        warehouse_id: destWarehouseId,
        name: encryptText(decName, destWarehouseId),
        sku: encryptText(decSku, destWarehouseId),
        category: encryptText(decryptText(srcItem.category, sourceWarehouseId), destWarehouseId),
        quantity,
        unit: srcItem.unit,
        price: srcItem.price,
        warehouseLocation: {
          zone: encryptText(decryptText(srcItem.warehouseLocation?.zone || 'Zone A', sourceWarehouseId), destWarehouseId),
          aisle: encryptText(decryptText(srcItem.warehouseLocation?.aisle || 'Aisle 01', sourceWarehouseId), destWarehouseId),
          shelf: encryptText(decryptText(srcItem.warehouseLocation?.shelf || 'Level 1', sourceWarehouseId), destWarehouseId),
          bin: encryptText(decryptText(srcItem.warehouseLocation?.bin || 'Bin 01', sourceWarehouseId), destWarehouseId)
        },
        minThreshold: srcItem.minThreshold || 10,
        lastUpdated: now,
        notes: encryptText(`Transferred from ${sourceWarehouseId}`, destWarehouseId),
        is_archived: false,
        batch_number: batchNumber ? encryptText(batchNumber, destWarehouseId) : undefined
      });
    }

    // Log destination transfer in
    const destTxId = `tx-in-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    memTransactions.unshift({
      id: destTxId,
      warehouse_id: destWarehouseId,
      itemId: destItemId,
      itemName: encryptText(decName, destWarehouseId),
      sku: encryptText(decSku, destWarehouseId),
      type: 'TRANSFER_IN',
      quantity,
      reason: encryptText(transferReason, destWarehouseId),
      timestamp: now,
      operator: encryptText(operator, destWarehouseId),
      batch_number: batchNumber ? encryptText(batchNumber, destWarehouseId) : undefined,
      source_warehouse_id: sourceWarehouseId,
      dest_warehouse_id: destWarehouseId
    });

    return { success: true, sourceTxId: srcTxId, destTxId: destTxId };
  }
}

// --- Purchase Orders Workflow ---
export async function getPurchaseOrders(warehouseId: string) {
  if (usePostgres) {
    const res = await pool.query('SELECT * FROM purchase_orders WHERE warehouse_id = $1 ORDER BY created_at DESC', [warehouseId]);
    return res.rows.map((row: any) => ({
      id: row.id,
      poNumber: row.po_number,
      supplierId: row.supplier_id,
      supplierName: decryptText(row.supplier_name, warehouseId),
      status: row.status,
      items: JSON.parse(row.items_json || '[]'),
      totalAmount: parseFloat(row.total_amount || '0'),
      expectedDelivery: row.expected_delivery ? new Date(row.expected_delivery).toISOString() : undefined,
      notes: row.notes,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    }));
  } else {
    const pos = memPurchaseOrders.filter(po => po.warehouse_id === warehouseId);
    return pos.map(po => ({
      ...po,
      supplierName: decryptText(po.supplier_name, warehouseId)
    }));
  }
}

export async function savePurchaseOrder(po: any, warehouseId: string) {
  const encSupplierName = encryptText(po.supplierName || '', warehouseId);
  const itemsJson = JSON.stringify(po.items || []);
  const now = new Date().toISOString();

  if (usePostgres) {
    await pool.query(
      `INSERT INTO purchase_orders (id, warehouse_id, po_number, supplier_id, supplier_name, status, items_json, total_amount, expected_delivery, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET
         po_number = $3,
         supplier_id = $4,
         supplier_name = $5,
         status = $6,
         items_json = $7,
         total_amount = $8,
         expected_delivery = $9,
         notes = $10,
         updated_at = $12`,
      [
        po.id,
        warehouseId,
        po.poNumber,
        po.supplierId || null,
        encSupplierName,
        po.status || 'DRAFT',
        itemsJson,
        po.totalAmount || 0,
        po.expectedDelivery ? new Date(po.expectedDelivery) : null,
        po.notes || '',
        po.createdAt || now,
        now
      ]
    );
  } else {
    const idx = memPurchaseOrders.findIndex(p => p.id === po.id);
    const entry = {
      ...po,
      warehouse_id: warehouseId,
      supplier_name: encSupplierName,
      items: po.items || [],
      totalAmount: po.totalAmount || 0,
      updatedAt: now
    };
    if (idx !== -1) {
      memPurchaseOrders[idx] = entry;
    } else {
      memPurchaseOrders.unshift({ ...entry, createdAt: now });
    }
  }
}

export async function updatePurchaseOrderStatus(poId: string, warehouseId: string, newStatus: string, operator: string) {
  const now = new Date().toISOString();
  let po: any = null;

  if (usePostgres) {
    const res = await pool.query('SELECT * FROM purchase_orders WHERE id = $1 AND warehouse_id = $2', [poId, warehouseId]);
    if (res.rows.length === 0) throw new Error('Purchase order not found.');
    po = {
      ...res.rows[0],
      items: JSON.parse(res.rows[0].items_json || '[]')
    };

    await pool.query('UPDATE purchase_orders SET status = $1, updated_at = $2 WHERE id = $3 AND warehouse_id = $4', [newStatus, now, poId, warehouseId]);
  } else {
    const idx = memPurchaseOrders.findIndex(p => p.id === poId && p.warehouse_id === warehouseId);
    if (idx === -1) throw new Error('Purchase order not found.');
    memPurchaseOrders[idx].status = newStatus;
    memPurchaseOrders[idx].updatedAt = now;
    po = memPurchaseOrders[idx];
  }

  // If status is changed to RECEIVED, automatically restock inventory items!
  if (newStatus === 'RECEIVED' && po.items && po.items.length > 0) {
    const existingItems = await getItems(warehouseId);
    for (const poItem of po.items) {
      const match = existingItems.find((i: any) => i.sku.toLowerCase() === poItem.sku.toLowerCase());
      if (match) {
        await adjustStockAtomic(
          warehouseId,
          match.id,
          'INBOUND',
          poItem.quantity,
          `Received Purchase Order #${po.po_number || po.poNumber}`,
          operator,
          poItem.batchNumber
        );
      } else {
        // Create new inventory item for this PO receipt
        const newItemId = `item-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        await saveItem({
          id: newItemId,
          name: poItem.name,
          sku: poItem.sku,
          category: poItem.category || 'General',
          quantity: poItem.quantity,
          unit: 'pcs',
          price: poItem.unitPrice || 0,
          warehouseLocation: {
            zone: poItem.zone || 'Zone A',
            aisle: 'Aisle 01',
            shelf: 'Level 1',
            bin: 'Bin 01'
          },
          supplierId: po.supplier_id || po.supplierId,
          minThreshold: 10,
          lastUpdated: now,
          notes: `Created from PO #${po.po_number || po.poNumber}`,
          batchNumber: poItem.batchNumber,
          expiryDate: poItem.expiryDate
        }, warehouseId);

        await saveTransaction({
          id: `tx-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          itemId: newItemId,
          itemName: poItem.name,
          sku: poItem.sku,
          type: 'INBOUND',
          quantity: poItem.quantity,
          reason: `Initial stock receipt from PO #${po.po_number || po.poNumber}`,
          timestamp: now,
          operator,
          batchNumber: poItem.batchNumber
        }, warehouseId);
      }
    }
  }

  return { success: true, poId, status: newStatus };
}

export async function receivePurchaseOrderPartial(
  poId: string,
  warehouseId: string,
  receivedItems: { sku: string; quantityToReceive: number; batchNumber?: string }[],
  operator: string
) {
  const now = new Date().toISOString();
  let po: any = null;

  if (usePostgres) {
    const res = await pool.query('SELECT * FROM purchase_orders WHERE id = $1 AND warehouse_id = $2', [poId, warehouseId]);
    if (res.rows.length === 0) throw new Error('Purchase order not found.');
    po = {
      ...res.rows[0],
      items: JSON.parse(res.rows[0].items_json || '[]')
    };
  } else {
    const idx = memPurchaseOrders.findIndex(p => p.id === poId && p.warehouse_id === warehouseId);
    if (idx === -1) throw new Error('Purchase order not found.');
    po = memPurchaseOrders[idx];
  }

  const existingItems = await getItems(warehouseId);
  const updatedItemsList = [...(po.items || [])];
  let totalIntakeCount = 0;

  for (const rec of receivedItems) {
    if (!rec.quantityToReceive || rec.quantityToReceive <= 0) continue;

    const lineItem = updatedItemsList.find(i => i.sku.toLowerCase() === rec.sku.toLowerCase());
    if (!lineItem) continue;

    const prevReceived = lineItem.quantityReceived || 0;
    lineItem.quantityReceived = prevReceived + rec.quantityToReceive;
    totalIntakeCount += rec.quantityToReceive;

    // Adjust inventory stock atomically
    const existingInv = existingItems.find((i: any) => i.sku.toLowerCase() === rec.sku.toLowerCase());
    if (existingInv) {
      await adjustStockAtomic(
        warehouseId,
        existingInv.id,
        'INBOUND',
        rec.quantityToReceive,
        `PO Intake #${po.po_number || po.poNumber} (${rec.quantityToReceive} ${lineItem.unit || 'units'})`,
        operator,
        rec.batchNumber || lineItem.batchNumber
      );
    } else {
      const newItemId = `item-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      await saveItem({
        id: newItemId,
        name: lineItem.name,
        sku: lineItem.sku,
        category: lineItem.category || 'General',
        quantity: rec.quantityToReceive,
        unit: 'pcs',
        price: lineItem.unitPrice || 0,
        warehouseLocation: {
          zone: lineItem.zone || 'Zone A',
          aisle: 'Aisle 01',
          shelf: 'Level 1',
          bin: 'Bin 01'
        },
        supplierId: po.supplier_id || po.supplierId,
        minThreshold: 10,
        lastUpdated: now,
        notes: `Created from PO #${po.po_number || po.poNumber}`,
        batchNumber: rec.batchNumber || lineItem.batchNumber,
        expiryDate: lineItem.expiryDate
      }, warehouseId);

      await saveTransaction({
        id: `tx-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        itemId: newItemId,
        itemName: lineItem.name,
        sku: lineItem.sku,
        type: 'INBOUND',
        quantity: rec.quantityToReceive,
        reason: `Initial PO intake #${po.po_number || po.poNumber}`,
        timestamp: now,
        operator,
        batchNumber: rec.batchNumber || lineItem.batchNumber
      }, warehouseId);
    }
  }

  // Determine overall status
  const allFullyReceived = updatedItemsList.length > 0 && updatedItemsList.every(i => (i.quantityReceived || 0) >= i.quantity);
  const anyPartiallyReceived = updatedItemsList.some(i => (i.quantityReceived || 0) > 0);
  const newStatus = allFullyReceived ? 'RECEIVED' : (anyPartiallyReceived ? 'PARTIALLY_RECEIVED' : po.status);

  if (usePostgres) {
    await pool.query(
      'UPDATE purchase_orders SET status = $1, items_json = $2, updated_at = $3 WHERE id = $4 AND warehouse_id = $5',
      [newStatus, JSON.stringify(updatedItemsList), now, poId, warehouseId]
    );
  } else {
    const idx = memPurchaseOrders.findIndex(p => p.id === poId && p.warehouse_id === warehouseId);
    if (idx !== -1) {
      memPurchaseOrders[idx].items = updatedItemsList;
      memPurchaseOrders[idx].status = newStatus;
      memPurchaseOrders[idx].updatedAt = now;
    }
  }

  await logSystemAudit({
    warehouseId,
    action: newStatus === 'RECEIVED' ? 'PO_FULLY_RECEIVED' : 'PO_PARTIAL_INTAKE',
    category: 'PROCUREMENT',
    details: `PO #${po.po_number || po.poNumber} intake processed (${totalIntakeCount} units received). Status: ${newStatus}.`,
    operator,
    status: 'SUCCESS'
  });

  const updatedPOList = await getPurchaseOrders(warehouseId);
  const updatedPO = updatedPOList.find((p: any) => p.id === poId);

  return { success: true, purchaseOrder: updatedPO, status: newStatus };
}

export async function deletePurchaseOrder(poId: string, warehouseId: string) {
  if (usePostgres) {
    await pool.query('DELETE FROM purchase_orders WHERE id = $1 AND warehouse_id = $2', [poId, warehouseId]);
  } else {
    memPurchaseOrders = memPurchaseOrders.filter(p => !(p.id === poId && p.warehouse_id === warehouseId));
  }
}

// --- Audit Logging System ---
export async function logSystemAudit(params: {
  warehouseId: string;
  action: string;
  category: 'SECURITY' | 'INVENTORY' | 'TENANT' | 'USER' | 'TRANSFER' | 'PROCUREMENT';
  details: string;
  operator: string;
  operatorId?: string;
  ipAddress?: string;
  status?: 'SUCCESS' | 'WARNING' | 'FAILED';
}) {
  const { warehouseId, action, category, details, operator, operatorId, ipAddress, status = 'SUCCESS' } = params;
  const id = `audit-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  if (usePostgres) {
    try {
      await pool.query(
        `INSERT INTO audit_logs (id, warehouse_id, action, category, details, operator, operator_id, ip_address, status, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          warehouseId,
          action,
          category,
          encryptText(details, warehouseId),
          encryptText(operator, warehouseId),
          operatorId || null,
          ipAddress || null,
          status,
          now
        ]
      );
    } catch (err) {
      console.error('Failed to write audit log to PostgreSQL:', err);
    }
  } else {
    memAuditLogs.unshift({
      id,
      warehouse_id: warehouseId,
      action,
      category,
      details: encryptText(details, warehouseId),
      operator: encryptText(operator, warehouseId),
      operator_id: operatorId,
      ip_address: ipAddress,
      status,
      timestamp: now
    });
    if (memAuditLogs.length > 1000) {
      memAuditLogs.pop();
    }
  }
}

export async function getSystemAuditLogs(warehouseId: string, limit: number = 100) {
  if (usePostgres) {
    const res = await pool.query(
      'SELECT * FROM audit_logs WHERE warehouse_id = $1 ORDER BY timestamp DESC LIMIT $2',
      [warehouseId, limit]
    );
    return res.rows.map((row: any) => ({
      id: row.id,
      warehouseId: row.warehouse_id,
      action: row.action,
      category: row.category,
      details: decryptText(row.details, warehouseId),
      operator: decryptText(row.operator, warehouseId),
      operatorId: row.operator_id,
      ipAddress: row.ip_address,
      status: row.status,
      timestamp: (row.timestamp ? (typeof row.timestamp === 'string' ? row.timestamp : row.timestamp.toISOString()) : new Date().toISOString())
    }));
  } else {
    const filtered = memAuditLogs.filter(a => a.warehouse_id === warehouseId).slice(0, limit);
    return filtered.map(row => ({
      id: row.id,
      warehouseId: row.warehouse_id,
      action: row.action,
      category: row.category,
      details: decryptText(row.details, warehouseId),
      operator: decryptText(row.operator, warehouseId),
      operatorId: row.operator_id,
      ipAddress: row.ip_address,
      status: row.status,
      timestamp: row.timestamp
    }));
  }
}

// --- Personnel Dispatch Records System ---
export async function recordPersonnelDispatch(dispatch: any, warehouseId: string) {
  const id = `disp-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();
  const encItemName = encryptText(dispatch.itemName, warehouseId);
  const encSku = encryptText(dispatch.sku, warehouseId);
  const encRecipient = encryptText(dispatch.recipientName, warehouseId);
  const encDept = encryptText(dispatch.department || '', warehouseId);
  const encBadge = encryptText(dispatch.badgeNumber || '', warehouseId);
  const encProject = encryptText(dispatch.projectCode || '', warehouseId);
  const encOperator = encryptText(dispatch.operator, warehouseId);
  const encNotes = encryptText(dispatch.notes || '', warehouseId);

  if (usePostgres) {
    await pool.query(
      `INSERT INTO dispatch_records (id, warehouse_id, item_id, item_name, sku, quantity, recipient_name, department, badge_number, project_code, operator, timestamp, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        warehouseId,
        dispatch.itemId,
        encItemName,
        encSku,
        dispatch.quantity,
        encRecipient,
        encDept,
        encBadge,
        encProject,
        encOperator,
        now,
        encNotes
      ]
    );
  } else {
    memDispatchRecords.unshift({
      id,
      warehouse_id: warehouseId,
      itemId: dispatch.itemId,
      itemName: encItemName,
      sku: encSku,
      quantity: dispatch.quantity,
      recipientName: encRecipient,
      department: encDept,
      badgeNumber: encBadge,
      projectCode: encProject,
      operator: encOperator,
      timestamp: now,
      notes: encNotes
    });
  }

  await logSystemAudit({
    warehouseId,
    action: 'OUTBOUND_DISPATCH',
    category: 'INVENTORY',
    details: `Dispatched ${dispatch.quantity} units of SKU ${dispatch.sku} (${dispatch.itemName}) to ${dispatch.recipientName}${dispatch.department ? ` [${dispatch.department}]` : ''}.`,
    operator: dispatch.operator,
    status: 'SUCCESS'
  });

  return { id, ...dispatch, timestamp: now };
}

export async function getPersonnelDispatches(warehouseId: string) {
  if (usePostgres) {
    const res = await pool.query('SELECT * FROM dispatch_records WHERE warehouse_id = $1 ORDER BY timestamp DESC', [warehouseId]);
    return res.rows.map((row: any) => ({
      id: row.id,
      itemId: row.item_id,
      itemName: decryptText(row.item_name, warehouseId),
      sku: decryptText(row.sku, warehouseId),
      quantity: row.quantity,
      recipientName: decryptText(row.recipient_name, warehouseId),
      department: decryptText(row.department, warehouseId),
      badgeNumber: decryptText(row.badge_number, warehouseId),
      projectCode: decryptText(row.project_code, warehouseId),
      operator: decryptText(row.operator, warehouseId),
      timestamp: (row.timestamp ? (typeof row.timestamp === 'string' ? row.timestamp : row.timestamp.toISOString()) : new Date().toISOString()),
      notes: decryptText(row.notes, warehouseId)
    }));
  } else {
    const filtered = memDispatchRecords.filter(d => d.warehouse_id === warehouseId);
    return filtered.map(row => ({
      id: row.id,
      itemId: row.itemId,
      itemName: decryptText(row.itemName, warehouseId),
      sku: decryptText(row.sku, warehouseId),
      quantity: row.quantity,
      recipientName: decryptText(row.recipientName, warehouseId),
      department: decryptText(row.department, warehouseId),
      badgeNumber: decryptText(row.badgeNumber, warehouseId),
      projectCode: decryptText(row.projectCode, warehouseId),
      operator: decryptText(row.operator, warehouseId),
      timestamp: row.timestamp,
      notes: decryptText(row.notes, warehouseId)
    }));
  }
}

// --- Zone Capacity Calculation ---
export async function getZoneCapacity(warehouseId: string) {
  const zones = await getZones(warehouseId);
  const items = await getItems(warehouseId);

  return zones.map((z: any) => {
    const zoneItems = items.filter((i: any) => !i.isArchived && (i.warehouseLocation?.zone?.toLowerCase() === z.name.toLowerCase() || i.warehouseLocation?.zone === z.id));
    const currentOccupancy = zoneItems.reduce((acc: number, curr: any) => acc + (curr.quantity || 0), 0);
    const maxCapacity = z.maxCapacity || 1000;
    const occupancyPercentage = maxCapacity > 0 ? Math.round((currentOccupancy / maxCapacity) * 100) : 0;
    const isOverCapacity = currentOccupancy > maxCapacity;

    return {
      zoneId: z.id,
      zoneName: z.name,
      maxCapacity,
      currentOccupancy,
      occupancyPercentage,
      isOverCapacity,
      itemCount: zoneItems.length
    };
  });
}

// --- Live User Authentication & Role Verification ---
export async function verifyLiveUserAccess(userId: string, warehouseId: string, tokenVersion?: number) {
  if (usePostgres) {
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) return { valid: false, role: 'viewer', user: null };
    const user = userRes.rows[0];

    // Verify token version to revoke stale sessions immediately upon password change
    if (tokenVersion !== undefined && user.token_version !== undefined && user.token_version !== tokenVersion) {
      return { valid: false, role: 'viewer', user, reason: 'SESSION_REVOKED' };
    }

    const roleRes = await pool.query('SELECT role FROM user_warehouses WHERE user_id = $1 AND warehouse_id = $2', [userId, warehouseId]);
    if (roleRes.rows.length === 0) return { valid: false, role: 'viewer', user };

    return { valid: true, role: roleRes.rows[0].role || 'operator', user };
  } else {
    const user = memUsers.find(u => u.id === userId);
    if (!user) return { valid: false, role: 'viewer', user: null };

    if (tokenVersion !== undefined && user.tokenVersion !== undefined && user.tokenVersion !== tokenVersion) {
      return { valid: false, role: 'viewer', user, reason: 'SESSION_REVOKED' };
    }

    const mapping = memUserWarehouses.find(uw => uw.user_id === userId && uw.warehouse_id === warehouseId);
    if (!mapping) return { valid: false, role: 'viewer', user };

    return { valid: true, role: mapping.role || 'operator', user };
  }
}

// Deletes only the calling admin's own warehouse (and all its data) and their
// own account. Deliberately scoped to one tenant - a wipe reachable by any
// single logged-in admin must never be able to destroy other tenants' data.
export async function wipeWarehouseAndAccount(userId: string, warehouseId: string) {
  if (usePostgres) {
    console.log(`Wiping warehouse ${warehouseId} and account ${userId} at their request...`);
    await pool.query('DELETE FROM transactions WHERE warehouse_id = $1', [warehouseId]);
    await pool.query('DELETE FROM items WHERE warehouse_id = $1', [warehouseId]);
    await pool.query('DELETE FROM categories WHERE warehouse_id = $1', [warehouseId]);
    await pool.query('DELETE FROM suppliers WHERE warehouse_id = $1', [warehouseId]);
    await pool.query('DELETE FROM zones WHERE warehouse_id = $1', [warehouseId]);
    // Removing the warehouse cascades to its user_warehouses mappings.
    await pool.query('DELETE FROM warehouses WHERE id = $1', [warehouseId]);
    // Only remove the account itself if it has no other warehouses left.
    const remaining = await pool.query('SELECT 1 FROM user_warehouses WHERE user_id = $1 LIMIT 1', [userId]);
    if (remaining.rows.length === 0) {
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    }
  } else {
    memItems = memItems.filter(i => i.warehouse_id !== warehouseId);
    memTransactions = memTransactions.filter(t => t.warehouse_id !== warehouseId);
    memCategories = memCategories.filter(c => c.warehouse_id !== warehouseId);
    memSuppliers = memSuppliers.filter(s => s.warehouse_id !== warehouseId);
    memZones = memZones.filter(z => z.warehouse_id !== warehouseId);
    memWarehouses = memWarehouses.filter(w => w.id !== warehouseId);
    memUserWarehouses = memUserWarehouses.filter(uw => uw.warehouse_id !== warehouseId);
    const stillHasWarehouse = memUserWarehouses.some(uw => uw.user_id === userId);
    if (!stillHasWarehouse) {
      memUsers = memUsers.filter(u => u.id !== userId);
    }
  }
}

export async function resetDb(warehouseId: string) {
  if (usePostgres) {
    console.log(`Resetting database tables for warehouse ${warehouseId}...`);
    // Delete only scoped data to preserve other warehouses!
    await pool.query('DELETE FROM transactions WHERE warehouse_id = $1', [warehouseId]);
    await pool.query('DELETE FROM items WHERE warehouse_id = $1', [warehouseId]);
    await pool.query('DELETE FROM categories WHERE warehouse_id = $1', [warehouseId]);
    await pool.query('DELETE FROM suppliers WHERE warehouse_id = $1', [warehouseId]);
    await pool.query('DELETE FROM zones WHERE warehouse_id = $1', [warehouseId]);
    await seedWarehouseData(warehouseId);
  } else {
    // Clear and re-seed scoped in-memory data
    memItems = memItems.filter(i => i.warehouse_id !== warehouseId);
    memTransactions = memTransactions.filter(t => t.warehouse_id !== warehouseId);
    memSuppliers = memSuppliers.filter(s => s.warehouse_id !== warehouseId);
    memCategories = memCategories.filter(c => c.warehouse_id !== warehouseId);
    memZones = memZones.filter(z => z.warehouse_id !== warehouseId);
    await seedWarehouseData(warehouseId);
  }
}

// --- User Warehouses Mapping Helpers ---

export async function associateUserWithWarehouse(userId: string, warehouseId: string, role: string = 'admin') {
  const safeRole = normalizeRole(role);
  if (usePostgres) {
    await pool.query(
      `INSERT INTO user_warehouses (user_id, warehouse_id, role) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (user_id, warehouse_id) DO UPDATE SET role = EXCLUDED.role`,
      [userId, warehouseId, safeRole]
    );
  } else {
    const existingIndex = memUserWarehouses.findIndex(uw => uw.user_id === userId && uw.warehouse_id === warehouseId);
    if (existingIndex !== -1) {
      memUserWarehouses[existingIndex].role = safeRole;
    } else {
      memUserWarehouses.push({ user_id: userId, warehouse_id: warehouseId, role: safeRole });
    }
  }
}

export async function getUserWarehouses(userId: string) {
  if (usePostgres) {
    const res = await pool.query(
      `SELECT w.*, uw.role FROM warehouses w
       JOIN user_warehouses uw ON w.id = uw.warehouse_id
       WHERE uw.user_id = $1`,
      [userId]
    );
    return res.rows;
  } else {
    const matches = memUserWarehouses.filter(uw => uw.user_id === userId);
    return matches.map(uw => {
      const w = memWarehouses.find(wh => wh.id === uw.warehouse_id);
      return w ? { ...w, role: uw.role || 'admin' } : null;
    }).filter(Boolean);
  }
}

export async function isUserInWarehouse(userId: string, warehouseId: string) {
  if (usePostgres) {
    const res = await pool.query(
      `SELECT 1 FROM user_warehouses WHERE user_id = $1 AND warehouse_id = $2`,
      [userId, warehouseId]
    );
    return res.rows.length > 0;
  } else {
    return memUserWarehouses.some(uw => uw.user_id === userId && uw.warehouse_id === warehouseId);
  }
}

export async function updateUserActiveWarehouse(userId: string, warehouseId: string) {
  if (usePostgres) {
    await pool.query(
      `UPDATE users SET warehouse_id = $1 WHERE id = $2`,
      [warehouseId, userId]
    );
  } else {
    memUsers = memUsers.map(u => u.id === userId ? { ...u, warehouseId } : u);
  }
}

export async function getUserRoleInWarehouse(userId: string, warehouseId: string): Promise<string> {
  if (usePostgres) {
    const res = await pool.query('SELECT role FROM user_warehouses WHERE user_id = $1 AND warehouse_id = $2', [userId, warehouseId]);
    return res.rows[0] ? normalizeRole(res.rows[0].role) : 'viewer';
  }
  const found = memUserWarehouses.find(uw => uw.user_id === userId && uw.warehouse_id === warehouseId);
  return found ? normalizeRole(found.role) : 'viewer';
}

export async function updateWarehouse(id: string, updates: { 
  name: string, 
  address?: string, 
  email?: string, 
  phone?: string, 
  contact_name?: string, 
  layout_rows?: number, 
  layout_cols?: number,
  layout_zones?: string
}) {
  if (usePostgres) {
    await pool.query(
      `UPDATE warehouses 
       SET name = $1, address = $2, email = $3, phone = $4, contact_name = $5, 
           layout_rows = $6, layout_cols = $7, layout_zones = $8 
       WHERE id = $9`,
      [
        updates.name, 
        updates.address || null, 
        updates.email || null, 
        updates.phone || null, 
        updates.contact_name || null, 
        updates.layout_rows ?? 5, 
        updates.layout_cols ?? 5, 
        updates.layout_zones || '[]',
        id
      ]
    );
  } else {
    memWarehouses = memWarehouses.map(w => {
      if (w.id === id) {
        return {
          ...w,
          ...updates
        };
      }
      return w;
    });
  }
  return { id, ...updates };
}

export async function getWarehouseUsers(warehouseId: string) {
  if (usePostgres) {
    const res = await pool.query(
      `SELECT u.id, u.email, u.name, uw.role 
       FROM users u 
       JOIN user_warehouses uw ON u.id = uw.user_id 
       WHERE uw.warehouse_id = $1`,
      [warehouseId]
    );
    return res.rows;
  } else {
    const mappings = memUserWarehouses.filter(uw => uw.warehouse_id === warehouseId);
    return mappings.map(uw => {
      const u = memUsers.find(user => user.id === uw.user_id);
      return u ? { id: u.id, email: u.email, name: u.name, role: uw.role || 'admin' } : null;
    }).filter(Boolean);
  }
}

export async function updateWarehouseUserRole(warehouseId: string, userId: string, role: string) {
  const safeRole = normalizeRole(role);
  if (usePostgres) {
    await pool.query(
      `UPDATE user_warehouses SET role = $1 WHERE warehouse_id = $2 AND user_id = $3`,
      [safeRole, warehouseId, userId]
    );
  } else {
    memUserWarehouses = memUserWarehouses.map(uw => {
      if (uw.warehouse_id === warehouseId && uw.user_id === userId) {
        return { ...uw, role: safeRole };
      }
      return uw;
    });
  }
}

export async function removeUserFromWarehouse(warehouseId: string, userId: string) {
  if (usePostgres) {
    await pool.query(
      `DELETE FROM user_warehouses WHERE warehouse_id = $1 AND user_id = $2`,
      [warehouseId, userId]
    );
    // If the active warehouse_id of the user was this warehouse, update it to another or null
    const checkActive = await pool.query(`SELECT warehouse_id FROM users WHERE id = $1`, [userId]);
    if (checkActive.rows[0]?.warehouse_id === warehouseId) {
      const remaining = await pool.query(`SELECT warehouse_id FROM user_warehouses WHERE user_id = $1 LIMIT 1`, [userId]);
      const nextWhId = remaining.rows[0]?.warehouse_id || null;
      await pool.query(`UPDATE users SET warehouse_id = $1 WHERE id = $2`, [nextWhId, userId]);
    }
  } else {
    memUserWarehouses = memUserWarehouses.filter(uw => !(uw.warehouse_id === warehouseId && uw.user_id === userId));
    const userIndex = memUsers.findIndex(u => u.id === userId);
    if (userIndex !== -1 && memUsers[userIndex].warehouseId === warehouseId) {
      const remaining = memUserWarehouses.find(uw => uw.user_id === userId);
      memUsers[userIndex].warehouseId = remaining ? remaining.warehouse_id : null;
    }
  }
}

export interface WorkspaceInvitationPreview {
  id: string;
  warehouseId: string;
  warehouseName: string;
  maskedEmail: string;
  role: string;
  expiresAt: string;
}

function validateInviteRole(role: string): string {
  if (!isAssignableWorkspaceRole(role)) throw new Error('Invalid workspace role.');
  return role;
}

export async function createWorkspaceInvitation(params: {
  warehouseId: string;
  email: string;
  name?: string;
  role: string;
  createdBy: string;
  ttlHours?: number;
}) {
  const email = normalizeInvitationEmail(params.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid email address is required.');
  const role = validateInviteRole(params.role);
  const ttlHours = Math.min(Math.max(Math.trunc(params.ttlHours || WORKSPACE_INVITE_TTL_HOURS), 1), 168);
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashWorkspaceInvitationToken(rawToken);
  const id = `invite-${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  const createdAt = new Date().toISOString();

  if (usePostgres) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const warehouse = await client.query('SELECT id FROM warehouses WHERE id=$1 FOR SHARE', [params.warehouseId]);
      if (!warehouse.rows[0]) throw new Error('Workspace not found.');
      await client.query(
        `UPDATE swim_workspace_invitations SET revoked_at=CURRENT_TIMESTAMP
         WHERE warehouse_id=$1 AND lower(email)=lower($2) AND accepted_at IS NULL AND revoked_at IS NULL`,
        [params.warehouseId, email],
      );
      await client.query(
        `INSERT INTO swim_workspace_invitations
         (id, warehouse_id, email, display_name, role, token_hash, created_by, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, params.warehouseId, email, params.name?.trim() || null, role, tokenHash, params.createdBy, expiresAt, createdAt],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } else {
    memWorkspaceInvitations = memWorkspaceInvitations.map((invite) =>
      invite.warehouseId === params.warehouseId && invite.email === email && !invite.acceptedAt && !invite.revokedAt
        ? { ...invite, revokedAt: createdAt }
        : invite,
    );
    memWorkspaceInvitations.push({ id, warehouseId: params.warehouseId, email, displayName: params.name?.trim() || '', role, tokenHash, createdBy: params.createdBy, expiresAt, createdAt });
  }

  return { id, warehouseId: params.warehouseId, email, name: params.name?.trim() || '', role, expiresAt, token: rawToken };
}

export async function listWorkspaceInvitations(warehouseId: string) {
  if (usePostgres) {
    const result = await pool.query(
      `SELECT id, email, display_name, role, expires_at, accepted_at, revoked_at, created_at
       FROM swim_workspace_invitations WHERE warehouse_id=$1 ORDER BY created_at DESC LIMIT 200`,
      [warehouseId],
    );
    return result.rows.map((row: any) => ({
      id: row.id, email: row.email, name: row.display_name || '', role: normalizeRole(row.role),
      expiresAt: new Date(row.expires_at).toISOString(), acceptedAt: row.accepted_at ? new Date(row.accepted_at).toISOString() : undefined,
      revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : undefined, createdAt: new Date(row.created_at).toISOString(),
    }));
  }
  return memWorkspaceInvitations.filter((invite) => invite.warehouseId === warehouseId).map(({ tokenHash, ...invite }) => invite);
}

async function loadValidInvitation(token: string, client?: any) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) throw new Error('Invitation is invalid or expired.');
  const tokenHash = hashWorkspaceInvitationToken(token);
  if (usePostgres) {
    const db = client || pool;
    const result = await db.query(
      `SELECT i.*, w.name AS warehouse_name FROM swim_workspace_invitations i
       JOIN warehouses w ON w.id=i.warehouse_id
       WHERE i.token_hash=$1`,
      [tokenHash],
    );
    const invite = result.rows[0];
    if (!invite || invite.accepted_at || invite.revoked_at || Date.parse(invite.expires_at) <= Date.now()) {
      throw new Error('Invitation is invalid or expired.');
    }
    return invite;
  }
  const invite = memWorkspaceInvitations.find((item) => item.tokenHash === tokenHash);
  if (!invite || invite.acceptedAt || invite.revokedAt || Date.parse(invite.expiresAt) <= Date.now()) throw new Error('Invitation is invalid or expired.');
  const warehouse = memWarehouses.find((item) => item.id === invite.warehouseId);
  return { ...invite, warehouse_id: invite.warehouseId, display_name: invite.displayName, expires_at: invite.expiresAt, warehouse_name: warehouse?.name || 'SWIM workspace' };
}

export async function getWorkspaceInvitationPreview(token: string): Promise<WorkspaceInvitationPreview> {
  const invite = await loadValidInvitation(token);
  return {
    id: invite.id,
    warehouseId: invite.warehouse_id || invite.warehouseId,
    warehouseName: invite.warehouse_name || 'SWIM workspace',
    maskedEmail: maskInvitationEmail(invite.email),
    role: normalizeRole(invite.role),
    expiresAt: new Date(invite.expires_at || invite.expiresAt).toISOString(),
  };
}

export async function acceptWorkspaceInvitationForExistingUser(token: string, userId: string, userEmail: string) {
  const normalizedEmail = userEmail.toLowerCase().trim();
  if (usePostgres) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tokenHash = hashWorkspaceInvitationToken(token);
      const result = await client.query(
        `SELECT i.*, w.name AS warehouse_name FROM swim_workspace_invitations i JOIN warehouses w ON w.id=i.warehouse_id
         WHERE i.token_hash=$1 FOR UPDATE OF i`,
        [tokenHash],
      );
      const invite = result.rows[0];
      if (!invite || invite.accepted_at || invite.revoked_at || Date.parse(invite.expires_at) <= Date.now()) throw new Error('Invitation is invalid or expired.');
      if (!invitedEmailMatches(invite.email, normalizedEmail)) throw new Error('This invitation was issued to a different email address.');
      await client.query(
        `INSERT INTO user_warehouses(user_id, warehouse_id, role) VALUES($1,$2,$3)
         ON CONFLICT(user_id,warehouse_id) DO UPDATE SET role=EXCLUDED.role`,
        [userId, invite.warehouse_id, normalizeRole(invite.role)],
      );
      await client.query('UPDATE users SET warehouse_id=$1 WHERE id=$2', [invite.warehouse_id, userId]);
      await client.query('UPDATE swim_workspace_invitations SET accepted_at=CURRENT_TIMESTAMP WHERE id=$1', [invite.id]);
      await client.query('COMMIT');
      return { warehouseId: invite.warehouse_id, warehouseName: invite.warehouse_name, role: normalizeRole(invite.role) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  const invite = await loadValidInvitation(token);
  if (!invitedEmailMatches(invite.email, normalizedEmail)) throw new Error('This invitation was issued to a different email address.');
  await associateUserWithWarehouse(userId, invite.warehouseId, invite.role);
  await updateUserActiveWarehouse(userId, invite.warehouseId);
  memWorkspaceInvitations = memWorkspaceInvitations.map((item) => item.id === invite.id ? { ...item, acceptedAt: new Date().toISOString() } : item);
  return { warehouseId: invite.warehouseId, warehouseName: invite.warehouse_name, role: normalizeRole(invite.role) };
}

export async function registerWithWorkspaceInvitation(params: {
  token: string;
  email: string;
  name: string;
  passwordHash: string;
}) {
  const email = normalizeInvitationEmail(params.email);
  if (usePostgres) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tokenHash = hashWorkspaceInvitationToken(params.token);
      const result = await client.query(
        `SELECT i.*, w.name AS warehouse_name, w.code, w.address FROM swim_workspace_invitations i JOIN warehouses w ON w.id=i.warehouse_id
         WHERE i.token_hash=$1 FOR UPDATE OF i`,
        [tokenHash],
      );
      const invite = result.rows[0];
      if (!invite || invite.accepted_at || invite.revoked_at || Date.parse(invite.expires_at) <= Date.now()) throw new Error('Invitation is invalid or expired.');
      if (!invitedEmailMatches(invite.email, email)) throw new Error('This invitation was issued to a different email address.');
      const existing = await client.query('SELECT id FROM users WHERE lower(email)=lower($1)', [email]);
      if (existing.rows[0]) throw new Error('An account already exists for this email. Sign in and accept the invitation instead.');
      const userId = `usr-${crypto.randomUUID()}`;
      const displayName = params.name.trim() || invite.display_name || email.split('@')[0];
      await client.query(
        `INSERT INTO users(id,email,password_hash,name,warehouse_id,provider,token_version) VALUES($1,$2,$3,$4,$5,'email',1)`,
        [userId, email, params.passwordHash, displayName, invite.warehouse_id],
      );
      await client.query('INSERT INTO user_warehouses(user_id,warehouse_id,role) VALUES($1,$2,$3)', [userId, invite.warehouse_id, normalizeRole(invite.role)]);
      await client.query('UPDATE swim_workspace_invitations SET accepted_at=CURRENT_TIMESTAMP WHERE id=$1', [invite.id]);
      await client.query('COMMIT');
      return {
        user: { id: userId, email, name: displayName, tokenVersion: 1 },
        warehouse: { id: invite.warehouse_id, name: invite.warehouse_name, code: invite.code, address: invite.address || '' },
        role: normalizeRole(invite.role),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  const invite = await loadValidInvitation(params.token);
  if (!invitedEmailMatches(invite.email, email)) throw new Error('This invitation was issued to a different email address.');
  if (memUsers.some((user) => user.email?.toLowerCase() === email)) throw new Error('An account already exists for this email. Sign in and accept the invitation instead.');
  const user = { id: `usr-${crypto.randomUUID()}`, email, passwordHash: params.passwordHash, name: params.name.trim() || invite.displayName || email.split('@')[0], warehouseId: invite.warehouseId, provider: 'email', tokenVersion: 1 };
  memUsers.push(user);
  await associateUserWithWarehouse(user.id, invite.warehouseId, invite.role);
  memWorkspaceInvitations = memWorkspaceInvitations.map((item) => item.id === invite.id ? { ...item, acceptedAt: new Date().toISOString() } : item);
  return { user, warehouse: memWarehouses.find((item) => item.id === invite.warehouseId), role: normalizeRole(invite.role) };
}

// ---------------------------------------------------------------------------
// SWIM enterprise logistics repositories
// ---------------------------------------------------------------------------

function mapShipmentRow(row: any): ShipmentRecord {
  return {
    id: row.id,
    warehouseId: row.warehouse_id || row.warehouseId,
    reference: row.reference,
    mode: row.mode,
    status: row.status,
    carrier: row.carrier || undefined,
    trackingNumber: row.tracking_number || row.trackingNumber || undefined,
    trackingProvider: row.tracking_provider || row.trackingProvider || undefined,
    purchaseOrderId: row.purchase_order_id || row.purchaseOrderId || undefined,
    supplierId: row.supplier_id || row.supplierId || undefined,
    customerOrderReference: row.customer_order_reference || row.customerOrderReference || undefined,
    origin: row.origin || undefined,
    destination: row.destination || undefined,
    estimatedArrivalAt: row.estimated_arrival_at ? new Date(row.estimated_arrival_at).toISOString() : row.estimatedArrivalAt,
    latestLocation: row.latest_location || row.latestLocation || undefined,
    latestTrackingStatus: row.latest_tracking_status || row.latestTrackingStatus || undefined,
    createdAt: new Date(row.created_at || row.createdAt).toISOString(),
    updatedAt: new Date(row.updated_at || row.updatedAt).toISOString(),
  };
}

export async function reserveSwimWebhookReceipt(input: {
  replayKey: string;
  providerKey: string;
  providerEventId: string;
  bodyHash: string;
  warehouseId?: string;
  shipmentId?: string;
  expiresAt: string;
}): Promise<boolean> {
  if (usePostgres) {
    await pool.query('DELETE FROM swim_webhook_receipts WHERE expires_at < CURRENT_TIMESTAMP');
    const result = await pool.query(
      `INSERT INTO swim_webhook_receipts (
        replay_key, provider_key, provider_event_id, body_hash, warehouse_id, shipment_id, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT DO NOTHING
      RETURNING replay_key`,
      [input.replayKey, input.providerKey, input.providerEventId, input.bodyHash,
       input.warehouseId || null, input.shipmentId || null, input.expiresAt],
    );
    return result.rowCount === 1;
  }

  const now = Date.now();
  memWebhookReceipts = memWebhookReceipts.filter((entry) => Date.parse(entry.expiresAt) > now);
  const duplicate = memWebhookReceipts.some((entry) =>
    entry.replayKey === input.replayKey ||
    (entry.providerKey === input.providerKey && entry.providerEventId === input.providerEventId),
  );
  if (duplicate) return false;
  memWebhookReceipts.push({ ...input, receivedAt: new Date().toISOString() });
  if (memWebhookReceipts.length > 10_000) memWebhookReceipts.splice(0, memWebhookReceipts.length - 10_000);
  return true;
}

export async function createSwimShipment(
  warehouseId: string,
  shipment: Omit<ShipmentRecord, 'warehouseId' | 'createdAt' | 'updatedAt'>,
): Promise<ShipmentRecord> {
  const now = new Date().toISOString();
  if (usePostgres) {
    const result = await pool.query(
      `INSERT INTO swim_shipments (
        id, warehouse_id, reference, mode, status, carrier, tracking_number, tracking_provider,
        purchase_order_id, supplier_id, customer_order_reference, origin, destination,
        estimated_arrival_at, latest_location, latest_tracking_status, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)
      RETURNING *`,
      [shipment.id, warehouseId, shipment.reference, shipment.mode, shipment.status,
       shipment.carrier || null, shipment.trackingNumber || null, shipment.trackingProvider || null,
       shipment.purchaseOrderId || null, shipment.supplierId || null, shipment.customerOrderReference || null,
       shipment.origin || null, shipment.destination || null, shipment.estimatedArrivalAt || null,
       shipment.latestLocation || null, shipment.latestTrackingStatus || null, now],
    );
    return mapShipmentRow(result.rows[0]);
  }
  const record: ShipmentRecord = { ...shipment, warehouseId, createdAt: now, updatedAt: now };
  memShipments.push(record);
  return record;
}

export async function listSwimShipments(warehouseId: string, limit = 100): Promise<ShipmentRecord[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 100, 1), 500);
  if (usePostgres) {
    const result = await pool.query(
      `SELECT * FROM swim_shipments WHERE warehouse_id = $1 ORDER BY updated_at DESC LIMIT $2`,
      [warehouseId, safeLimit],
    );
    return result.rows.map(mapShipmentRow);
  }
  return memShipments.filter((shipment) => shipment.warehouseId === warehouseId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, safeLimit);
}

export async function getSwimShipment(warehouseId: string, shipmentId: string): Promise<ShipmentRecord | null> {
  if (usePostgres) {
    const result = await pool.query(
      `SELECT * FROM swim_shipments WHERE warehouse_id = $1 AND id = $2`,
      [warehouseId, shipmentId],
    );
    return result.rows[0] ? mapShipmentRow(result.rows[0]) : null;
  }
  return memShipments.find((shipment) => shipment.warehouseId === warehouseId && shipment.id === shipmentId) || null;
}

function trackingToShipmentStatus(status: TrackingCheckpoint['status']): ShipmentRecord['status'] {
  if (status === 'DELIVERED') return 'DELIVERED';
  if (status === 'CUSTOMS') return 'CUSTOMS';
  if (status === 'EXCEPTION' || status === 'RETURNED') return 'EXCEPTION';
  if (status === 'LABEL_CREATED') return 'BOOKED';
  return 'IN_TRANSIT';
}

export async function addSwimTrackingCheckpoint(
  warehouseId: string,
  shipmentId: string,
  checkpoint: TrackingCheckpoint & { id: string; payloadHash?: string },
): Promise<TrackingCheckpoint> {
  const shipment = await getSwimShipment(warehouseId, shipmentId);
  if (!shipment) throw new Error('Shipment not found in this workspace.');
  const nextShipmentStatus = trackingToShipmentStatus(checkpoint.status);
  if (usePostgres) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO swim_tracking_events (
          id, warehouse_id, shipment_id, carrier_event_id, status, description, location,
          occurred_at, estimated_delivery_at, source, payload_hash
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (shipment_id, carrier_event_id) DO NOTHING
        RETURNING id`,
        [checkpoint.id, warehouseId, shipmentId, checkpoint.carrierEventId || null, checkpoint.status,
         checkpoint.description, checkpoint.location || null, checkpoint.occurredAt,
         checkpoint.estimatedDeliveryAt || null, checkpoint.source, checkpoint.payloadHash || null],
      );
      if (inserted.rowCount === 1) {
        await client.query(
          `UPDATE swim_shipments SET status=$1, latest_tracking_status=$2, latest_location=COALESCE($3, latest_location),
           estimated_arrival_at=COALESCE($4, estimated_arrival_at), updated_at=CURRENT_TIMESTAMP
           WHERE id=$5 AND warehouse_id=$6`,
          [nextShipmentStatus, checkpoint.status, checkpoint.location || null, checkpoint.estimatedDeliveryAt || null, shipmentId, warehouseId],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } else {
    const duplicate = checkpoint.carrierEventId && memTrackingEvents.some((event) =>
      event.shipmentId === shipmentId && event.carrierEventId === checkpoint.carrierEventId,
    );
    if (!duplicate) {
      memTrackingEvents.push({ ...checkpoint, warehouseId, shipmentId });
      memShipments = memShipments.map((entry) => entry.warehouseId === warehouseId && entry.id === shipmentId ? {
        ...entry,
        status: nextShipmentStatus,
        latestTrackingStatus: checkpoint.status,
        latestLocation: checkpoint.location || entry.latestLocation,
        estimatedArrivalAt: checkpoint.estimatedDeliveryAt || entry.estimatedArrivalAt,
        updatedAt: new Date().toISOString(),
      } : entry);
    }
  }
  return checkpoint;
}

export async function listSwimTrackingCheckpoints(warehouseId: string, shipmentId: string): Promise<TrackingCheckpoint[]> {
  if (!await getSwimShipment(warehouseId, shipmentId)) throw new Error('Shipment not found in this workspace.');
  if (usePostgres) {
    const result = await pool.query(
      `SELECT id, carrier_event_id, status, description, location, occurred_at, estimated_delivery_at, source
       FROM swim_tracking_events WHERE warehouse_id=$1 AND shipment_id=$2 ORDER BY occurred_at ASC`,
      [warehouseId, shipmentId],
    );
    return result.rows.map((row: any) => ({
      id: row.id,
      carrierEventId: row.carrier_event_id || undefined,
      status: row.status,
      description: row.description,
      location: row.location || undefined,
      occurredAt: new Date(row.occurred_at).toISOString(),
      estimatedDeliveryAt: row.estimated_delivery_at ? new Date(row.estimated_delivery_at).toISOString() : undefined,
      source: row.source,
    }));
  }
  return memTrackingEvents.filter((event) => event.warehouseId === warehouseId && event.shipmentId === shipmentId)
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
}

export async function saveSwimLogisticsUnit(warehouseId: string, unit: LogisticsUnit): Promise<LogisticsUnit> {
  if (!await getSwimShipment(warehouseId, unit.shipmentId)) throw new Error('Shipment not found in this workspace.');
  if (unit.parentUnitId) {
    const parent = usePostgres
      ? (await pool.query(`SELECT id, shipment_id FROM swim_logistics_units WHERE id=$1 AND warehouse_id=$2`, [unit.parentUnitId, warehouseId])).rows[0]
      : memLogisticsUnits.find((candidate) => candidate.id === unit.parentUnitId && candidate.warehouseId === warehouseId);
    if (!parent || (parent.shipment_id || parent.shipmentId) !== unit.shipmentId) throw new Error('Parent logistics unit is not part of this shipment.');
  }
  if (usePostgres) {
    await pool.query(
      `INSERT INTO swim_logistics_units (id, warehouse_id, shipment_id, parent_unit_id, unit_type, reference, quantity, weight_grams)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [unit.id, warehouseId, unit.shipmentId, unit.parentUnitId || null, unit.type, unit.reference || null, unit.quantity || null, unit.weightGrams || null],
    );
  } else {
    memLogisticsUnits.push({ ...unit, warehouseId });
  }
  return unit;
}

export async function listSwimLogisticsUnits(warehouseId: string, shipmentId: string): Promise<LogisticsUnit[]> {
  if (usePostgres) {
    const result = await pool.query(
      `SELECT id, shipment_id, parent_unit_id, unit_type, reference, quantity, weight_grams
       FROM swim_logistics_units WHERE warehouse_id=$1 AND shipment_id=$2 ORDER BY created_at ASC`,
      [warehouseId, shipmentId],
    );
    return result.rows.map((row: any) => ({ id: row.id, shipmentId: row.shipment_id, parentUnitId: row.parent_unit_id || undefined, type: row.unit_type, reference: row.reference || undefined, quantity: row.quantity ?? undefined, weightGrams: row.weight_grams ?? undefined }));
  }
  return memLogisticsUnits.filter((unit) => unit.warehouseId === warehouseId && unit.shipmentId === shipmentId);
}

export async function getSwimCustomsRules(destinationCountry: string, valuationDate: string): Promise<CustomsChargeRule[]> {
  if (usePostgres) {
    const result = await pool.query(
      `SELECT * FROM swim_customs_rules
       WHERE active=TRUE AND destination_country=$1 AND effective_from <= $2::date
       AND (effective_to IS NULL OR effective_to >= $2::date)
       ORDER BY sequence ASC, id ASC`,
      [destinationCountry.toUpperCase(), valuationDate],
    );
    return result.rows.map((row: any) => ({
      id: row.id, destinationCountry: row.destination_country, hsCodePrefix: row.hs_code_prefix,
      chargeCode: row.charge_code, label: row.label, sequence: row.sequence, basis: row.basis,
      rateBps: row.rate_bps ?? undefined, fixedAmountMinor: row.fixed_amount_minor == null ? undefined : Number(row.fixed_amount_minor),
      effectiveFrom: row.effective_from.toISOString?.().slice(0,10) || String(row.effective_from),
      effectiveTo: row.effective_to ? (row.effective_to.toISOString?.().slice(0,10) || String(row.effective_to)) : undefined,
      eligibleOrigins: row.eligible_origins || undefined, excludedOrigins: row.excluded_origins || undefined,
      requiredConcessionCode: row.required_concession_code || undefined,
      source: { authority: row.authority, sourceUrl: row.source_url, verifiedAt: new Date(row.verified_at).toISOString() },
    }));
  }
  return memCustomsRules.filter((rule) => rule.destinationCountry === destinationCountry.toUpperCase());
}

export async function saveSwimCustomsEstimate(
  id: string,
  warehouseId: string,
  shipmentId: string | undefined,
  input: CustomsEstimateInput,
  result: CustomsEstimate,
  createdBy: string,
): Promise<void> {
  if (shipmentId && !await getSwimShipment(warehouseId, shipmentId)) throw new Error('Shipment not found in this workspace.');
  if (usePostgres) {
    await pool.query(
      `INSERT INTO swim_customs_estimates (id, warehouse_id, shipment_id, input_json, result_json, created_by)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6)`,
      [id, warehouseId, shipmentId || null, JSON.stringify(input), JSON.stringify(result), createdBy],
    );
  } else {
    memCustomsEstimates.push({ id, warehouseId, shipmentId, input, result, createdBy, createdAt: new Date().toISOString() });
  }
}

export async function appendSwimBusinessEvent(
  event: Omit<SwimBusinessEvent, 'previousHash' | 'eventHash'>,
): Promise<SwimBusinessEvent> {
  if (usePostgres) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`swim-ledger:${event.warehouseId}`]);
      const previous = await client.query(
        `SELECT event_hash FROM swim_business_events WHERE warehouse_id=$1 ORDER BY sequence_id DESC LIMIT 1`,
        [event.warehouseId],
      );
      const sealed = sealEvent(EVENT_LEDGER_SECRET, { ...event, previousHash: previous.rows[0]?.event_hash || null });
      await client.query(
        `INSERT INTO swim_business_events (
          event_id, warehouse_id, event_type, aggregate_type, aggregate_id, actor_id,
          occurred_at, payload_json, previous_hash, event_hash
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
        [sealed.eventId, sealed.warehouseId, sealed.eventType, sealed.aggregateType, sealed.aggregateId,
         sealed.actorId || null, sealed.occurredAt, JSON.stringify(sealed.payload), sealed.previousHash || null, sealed.eventHash],
      );
      await client.query('COMMIT');
      return sealed;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  const previous = [...memBusinessEvents].reverse().find((entry) => entry.warehouseId === event.warehouseId);
  const sealed = sealEvent(EVENT_LEDGER_SECRET, { ...event, previousHash: previous?.eventHash || null });
  memBusinessEvents.push(sealed);
  return sealed;
}

export async function listSwimBusinessEvents(warehouseId: string, limit = 100): Promise<SwimBusinessEvent[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 100, 1), 500);
  if (usePostgres) {
    const result = await pool.query(
      `SELECT event_id, warehouse_id, event_type, aggregate_type, aggregate_id, actor_id, occurred_at, payload_json, previous_hash, event_hash
       FROM swim_business_events WHERE warehouse_id=$1 ORDER BY sequence_id DESC LIMIT $2`,
      [warehouseId, safeLimit],
    );
    return result.rows.reverse().map((row: any) => ({ eventId: row.event_id, warehouseId: row.warehouse_id, eventType: row.event_type, aggregateType: row.aggregate_type, aggregateId: row.aggregate_id, actorId: row.actor_id || undefined, occurredAt: new Date(row.occurred_at).toISOString(), payload: row.payload_json || {}, previousHash: row.previous_hash, eventHash: row.event_hash }));
  }
  return memBusinessEvents.filter((entry) => entry.warehouseId === warehouseId).slice(-safeLimit);
}

export async function verifySwimBusinessEventLedger(warehouseId: string): Promise<{ valid: boolean; brokenAt?: string }> {
  const events = usePostgres
    ? (await pool.query(`SELECT event_id, warehouse_id, event_type, aggregate_type, aggregate_id, actor_id, occurred_at, payload_json, previous_hash, event_hash FROM swim_business_events WHERE warehouse_id=$1 ORDER BY sequence_id ASC`, [warehouseId])).rows.map((row: any) => ({ eventId: row.event_id, warehouseId: row.warehouse_id, eventType: row.event_type, aggregateType: row.aggregate_type, aggregateId: row.aggregate_id, actorId: row.actor_id || undefined, occurredAt: new Date(row.occurred_at).toISOString(), payload: row.payload_json || {}, previousHash: row.previous_hash, eventHash: row.event_hash }))
    : memBusinessEvents.filter((entry) => entry.warehouseId === warehouseId);
  return verifyEventChain(EVENT_LEDGER_SECRET, events);
}