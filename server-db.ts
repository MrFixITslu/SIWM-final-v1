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
const JWT_SECRET = process.env.JWT_SECRET || 'siwm-production-secure-key-2026';

function getWarehouseCryptoConfig(warehouseId: string) {
  const key = crypto.createHash('sha256').update(warehouseId + JWT_SECRET).digest();
  const iv = crypto.createHash('md5').update(warehouseId).digest();
  return { key, iv };
}

export function encryptText(text: string | null | undefined, warehouseId: string): string {
  if (!text) return '';
  try {
    const { key, iv } = getWarehouseCryptoConfig(warehouseId);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return 'enc_' + encrypted;
  } catch (err) {
    console.error('Encryption error:', err);
    return text || '';
  }
}

export function decryptText(encryptedText: string | null | undefined, warehouseId: string): string {
  if (!encryptedText) return '';
  if (!encryptedText.startsWith('enc_')) return encryptedText;
  try {
    const ciphertext = encryptedText.substring(4);
    const { key, iv } = getWarehouseCryptoConfig(warehouseId);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    return encryptedText;
  }
}

// --- Multi-Tenant In-Memory Storage Fallbacks ---
let memUserWarehouses: any[] = [
  { user_id: 'usr-demo', warehouse_id: 'wh-demo' }
];

let memWarehouses: any[] = [
  { 
    id: 'wh-demo', 
    name: 'Demo Central Warehouse', 
    code: 'DEMO123', 
    address: '123 Logistics Way, Chicago, IL', 
    createdAt: new Date().toISOString() 
  }
];

let memUsers: any[] = [
  { 
    id: 'usr-demo', 
    email: 'demo@siwm.org', 
    passwordHash: '$2a$10$W2G6k18vI.hQO639C0YxXuzX3Uj3m7T0O7jV38kXyV1YxW3G03vIq', // bcrypt hash for 'demo123'
    name: 'Demo Operator', 
    warehouseId: 'wh-demo', 
    provider: 'email', 
    createdAt: new Date().toISOString() 
  }
];

// Initialize in-memory arrays with 'wh-demo' mappings for initial seed data
let memCategories: any[] = INITIAL_CATEGORIES.map(cat => ({
  ...cat,
  id: `${cat.id}-wh-demo`,
  warehouse_id: 'wh-demo'
}));

let memSuppliers: any[] = INITIAL_SUPPLIERS.map(sup => ({
  ...sup,
  id: `${sup.id}-wh-demo`,
  warehouse_id: 'wh-demo'
}));

let memZones: any[] = INITIAL_ZONES.map(z => ({
  ...z,
  id: `${z.id}-wh-demo`,
  warehouse_id: 'wh-demo'
}));

let memItems: any[] = INITIAL_ITEMS.map(item => ({
  ...item,
  id: `${item.id}-wh-demo`,
  warehouse_id: 'wh-demo',
  supplierId: item.supplierId ? `${item.supplierId}-wh-demo` : undefined
}));

let memTransactions: any[] = INITIAL_TRANSACTIONS.map(tx => ({
  ...tx,
  id: `${tx.id}-wh-demo`,
  warehouse_id: 'wh-demo',
  itemId: `${tx.itemId}-wh-demo`
}));

export async function initDb() {
  console.log('Initializing database connectivity...');
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
      name VARCHAR(100) NOT NULL,
      description TEXT,
      color VARCHAR(50),
      UNIQUE(warehouse_id, name)
    )
  `);

  // 4. Suppliers Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id VARCHAR(50) PRIMARY KEY,
      warehouse_id VARCHAR(50) NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      contact_name VARCHAR(100),
      email VARCHAR(150),
      phone VARCHAR(50),
      address TEXT,
      UNIQUE(warehouse_id, name)
    )
  `);

  // 5. Zones Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zones (
      id VARCHAR(50) PRIMARY KEY,
      warehouse_id VARCHAR(50) NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      max_capacity INT,
      color VARCHAR(50),
      UNIQUE(warehouse_id, name)
    )
  `);

  // 6. Items Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS items (
      id VARCHAR(50) PRIMARY KEY,
      warehouse_id VARCHAR(50) NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      sku VARCHAR(100) NOT NULL,
      category VARCHAR(100) NOT NULL,
      quantity INT NOT NULL DEFAULT 0,
      unit VARCHAR(50) NOT NULL DEFAULT 'pcs',
      price DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
      zone VARCHAR(50) NOT NULL,
      aisle VARCHAR(50) NOT NULL,
      shelf VARCHAR(50) NOT NULL,
      bin VARCHAR(50) NOT NULL,
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
      item_name VARCHAR(255) NOT NULL,
      sku VARCHAR(100) NOT NULL,
      type VARCHAR(20) NOT NULL,
      quantity INT NOT NULL,
      reason TEXT,
      timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      operator VARCHAR(100)
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

  // 9. Database Migrations (Safely adding layout, contact details, and role columns)
  await pool.query(`ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS email VARCHAR(150)`);
  await pool.query(`ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`);
  await pool.query(`ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS contact_name VARCHAR(100)`);
  await pool.query(`ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS layout_rows INT DEFAULT 5`);
  await pool.query(`ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS layout_cols INT DEFAULT 5`);
  await pool.query(`ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS layout_zones TEXT DEFAULT '[]'`);
  await pool.query(`ALTER TABLE user_warehouses ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'admin'`);

  // Ensure default demo warehouse exists
  const whCheck = await pool.query("SELECT COUNT(*) FROM warehouses WHERE id = 'wh-demo'");
  if (parseInt(whCheck.rows[0].count, 10) === 0) {
    console.log('Seeding default central warehouse (wh-demo)...');
    await pool.query(
      "INSERT INTO warehouses (id, name, code, address, email, phone, contact_name, layout_rows, layout_cols, layout_zones) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      ['wh-demo', 'Demo Central Warehouse', 'DEMO123', '123 Logistics Way, Chicago, IL', 'demo-warehouse@siwm.org', '555-0199', 'Demo Administrator', 6, 8, '[]']
    );
  }

  // Ensure default demo user exists
  const userCheck = await pool.query("SELECT COUNT(*) FROM users WHERE email = 'demo@siwm.org'");
  if (parseInt(userCheck.rows[0].count, 10) === 0) {
    console.log('Seeding default demo user (demo@siwm.org)...');
    await pool.query(
      "INSERT INTO users (id, email, password_hash, name, warehouse_id, provider) VALUES ($1, $2, $3, $4, $5, $6)",
      ['usr-demo', 'demo@siwm.org', '$2a$10$W2G6k18vI.hQO639C0YxXuzX3Uj3m7T0O7jV38kXyV1YxW3G03vIq', 'Demo Operator', 'wh-demo', 'email']
    );
  }

  // Ensure default demo mapping exists
  await pool.query(`
    INSERT INTO user_warehouses (user_id, warehouse_id, role)
    VALUES ('usr-demo', 'wh-demo', 'admin')
    ON CONFLICT (user_id, warehouse_id) DO NOTHING
  `);

  // Seed default dataset for demo warehouse
  await seedWarehouseData('wh-demo');
  console.log('PostgreSQL database migration and seed completed successfully.');
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

  if (usePostgres) {
    await pool.query(
      `INSERT INTO items (id, warehouse_id, name, sku, category, quantity, unit, price, zone, aisle, shelf, bin, supplier_id, min_threshold, last_updated, notes) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
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
        encNotes
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
      notes: encNotes
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
        notes = $14 
       WHERE id = $15 AND warehouse_id = $16`,
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
      notes: encNotes
    } : i);
  }
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

  if (usePostgres) {
    await pool.query(
      `INSERT INTO transactions (id, warehouse_id, item_id, item_name, sku, type, quantity, reason, timestamp, operator) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
        encOperator
      ]
    );
  } else {
    memTransactions.unshift({
      ...tx,
      warehouse_id: warehouseId,
      itemName: encItemName,
      sku: encSku,
      reason: encReason,
      operator: encOperator
    });
  }
}

export async function wipeAllSystemData() {
  if (usePostgres) {
    console.log('Performing full administrative system wipe across all multi-tenant spaces...');
    await pool.query('DELETE FROM transactions');
    await pool.query('DELETE FROM items');
    await pool.query('DELETE FROM categories');
    await pool.query('DELETE FROM suppliers');
    await pool.query('DELETE FROM zones');
    await pool.query('DELETE FROM user_warehouses');
    await pool.query('DELETE FROM users');
    await pool.query('DELETE FROM warehouses');
  }

  // Clear all multi-tenant in-memory storage fallbacks
  memUserWarehouses = [];
  memWarehouses = [];
  memUsers = [];
  memCategories = [];
  memSuppliers = [];
  memZones = [];
  memItems = [];
  memTransactions = [];
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
  
  if (!user) {
    isNewUser = true;
    const userId = `usr-${Date.now()}`;
    // Default welcome password
    const passwordHash = await bcrypt.hash('welcome123', 10);
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
  return { user, isNewUser };
}
