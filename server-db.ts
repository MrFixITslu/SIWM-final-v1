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
// Kept as its own secret, separate from JWT_SECRET, so rotating login sessions
// never silently breaks decryption of already-stored data. The historical
// default is preserved here (rather than failing fast like JWT_SECRET) so any
// data already encrypted with it keeps decrypting after this upgrade. Set
// DATA_ENCRYPTION_SECRET explicitly for new deployments; rotating it on an
// existing deployment requires re-encrypting stored data first.
const DATA_ENCRYPTION_SECRET = process.env.DATA_ENCRYPTION_SECRET || 'siwm-production-secure-key-2026';
if (!process.env.DATA_ENCRYPTION_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('⚠️  DATA_ENCRYPTION_SECRET not set - falling back to the default key baked into this repo. Set DATA_ENCRYPTION_SECRET in your .env for a real deployment.');
}

// Whether to auto-create the built-in demo account/warehouse on every boot.
// Defaults OFF so a fresh/wiped database actually stays fresh across restarts.
const SEED_DEMO_DATA = (process.env.SEED_DEMO_DATA || 'false').toLowerCase() === 'true';

function getWarehouseKey(warehouseId: string): Buffer {
  return crypto.createHash('sha256').update(warehouseId + DATA_ENCRYPTION_SECRET).digest();
}

export function encryptText(text: string | null | undefined, warehouseId: string): string {
  if (!text) return '';
  try {
    const key = getWarehouseKey(warehouseId);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `encv2_${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error('Encryption error:', err);
    return text || '';
  }
}

export function decryptText(encryptedText: string | null | undefined, warehouseId: string): string {
  if (!encryptedText) return '';
  const key = getWarehouseKey(warehouseId);

  if (encryptedText.startsWith('encv2_')) {
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

  // Legacy format from before the AES-256-GCM upgrade: AES-256-CBC with a
  // static per-warehouse IV. Kept only so previously-stored data (encrypted
  // before this fix shipped) keeps decrypting correctly.
  if (encryptedText.startsWith('enc_')) {
    try {
      const ciphertext = encryptedText.substring(4);
      const legacyIv = crypto.createHash('md5').update(warehouseId).digest();
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, legacyIv);
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
  await pool.query(`ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS email VARCHAR(150)`);
  await pool.query(`ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`);
  await pool.query(`ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS contact_name VARCHAR(100)`);
  await pool.query(`ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS layout_rows INT DEFAULT 5`);
  await pool.query(`ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS layout_cols INT DEFAULT 5`);
  await pool.query(`ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS layout_zones TEXT DEFAULT '[]'`);
  await pool.query(`ALTER TABLE user_warehouses ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'admin'`);

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
export async function createUser(user: { id: string, email: string, passwordHash?: string, name: string, warehouseId: string, provider: string, providerId?: string }) {
  if (usePostgres) {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, name, warehouse_id, provider, provider_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user.id, user.email, user.passwordHash || null, user.name, user.warehouseId, user.provider, user.providerId || null]
    );
  } else {
    memUsers.push({
      ...user,
      createdAt: new Date().toISOString()
    });
  }
  return user;
}

export async function findUserByEmail(email: string) {
  const normEmail = email.toLowerCase().trim();
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
      providerId: row.provider_id
    };
  } else {
    const matched = memUsers.find(u => u.email.toLowerCase().trim() === normEmail);
    return matched ? { ...matched } : null;
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
      providerId: row.provider_id
    };
  } else {
    const matched = memUsers.find(u => u.provider === provider && u.providerId === providerId);
    return matched ? { ...matched } : null;
  }
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

export async function deletePurchaseOrder(poId: string, warehouseId: string) {
  if (usePostgres) {
    await pool.query('DELETE FROM purchase_orders WHERE id = $1 AND warehouse_id = $2', [poId, warehouseId]);
  } else {
    memPurchaseOrders = memPurchaseOrders.filter(p => !(p.id === poId && p.warehouse_id === warehouseId));
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
export async function verifyLiveUserAccess(userId: string, warehouseId: string) {
  if (usePostgres) {
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) return { valid: false, role: 'viewer', user: null };
    const user = userRes.rows[0];

    const roleRes = await pool.query('SELECT role FROM user_warehouses WHERE user_id = $1 AND warehouse_id = $2', [userId, warehouseId]);
    if (roleRes.rows.length === 0) return { valid: false, role: 'viewer', user };

    return { valid: true, role: roleRes.rows[0].role || 'operator', user };
  } else {
    const user = memUsers.find(u => u.id === userId);
    if (!user) return { valid: false, role: 'viewer', user: null };

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
  if (usePostgres) {
    await pool.query(
      `INSERT INTO user_warehouses (user_id, warehouse_id, role) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (user_id, warehouse_id) DO UPDATE SET role = EXCLUDED.role`,
      [userId, warehouseId, role]
    );
  } else {
    const existingIndex = memUserWarehouses.findIndex(uw => uw.user_id === userId && uw.warehouse_id === warehouseId);
    if (existingIndex !== -1) {
      memUserWarehouses[existingIndex].role = role;
    } else {
      memUserWarehouses.push({ user_id: userId, warehouse_id: warehouseId, role });
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
    return res.rows[0]?.role || 'operator';
  } else {
    const found = memUserWarehouses.find(uw => uw.user_id === userId && uw.warehouse_id === warehouseId);
    return found?.role || 'operator';
  }
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
  if (usePostgres) {
    await pool.query(
      `UPDATE user_warehouses SET role = $1 WHERE warehouse_id = $2 AND user_id = $3`,
      [role, warehouseId, userId]
    );
  } else {
    memUserWarehouses = memUserWarehouses.map(uw => {
      if (uw.warehouse_id === warehouseId && uw.user_id === userId) {
        return { ...uw, role };
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

export async function inviteUserToWarehouse(warehouseId: string, email: string, name: string, role: string) {
  const normEmail = email.toLowerCase().trim();
  let user = await findUserByEmail(normEmail);
  let isNewUser = false;
  let tempPassword: string | undefined;

  if (!user) {
    isNewUser = true;
    const userId = `usr-${Date.now()}`;
    // Each invited account gets its own random temporary password rather than
    // a single fixed password shared by every new operator account system-wide.
    tempPassword = crypto.randomBytes(9).toString('base64url');
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    user = {
      id: userId,
      email: normEmail,
      passwordHash,
      name: name || email.split('@')[0],
      warehouseId,
      provider: 'email'
    };
    await createUser(user);
  }

  await associateUserWithWarehouse(user.id, warehouseId, role);
  return { user, isNewUser, tempPassword };
}
