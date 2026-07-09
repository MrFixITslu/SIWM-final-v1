import pg from 'pg';
import { 
  INITIAL_CATEGORIES, 
  INITIAL_SUPPLIERS, 
  INITIAL_ZONES, 
  INITIAL_ITEMS, 
  INITIAL_TRANSACTIONS 
} from './src/mockData.js';

const { Pool } = pg;

// Connection options
// Default host is set to "postgres" as the database container is on the "proxy_network" docker network.
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

// In-Memory Backups (Fallback for sandbox environment)
let memItems = [...INITIAL_ITEMS];
let memTransactions = [...INITIAL_TRANSACTIONS];
let memSuppliers = [...INITIAL_SUPPLIERS];
let memCategories = [...INITIAL_CATEGORIES];
let memZones = [...INITIAL_ZONES];

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
    console.warn('Falling back to memory-backed cache storage for sandboxed AI Studio preview.');
    console.warn('When deployed in docker network "proxy_network", it will connect to Postgres automatically.\n');
    usePostgres = false;
  }
}

async function runMigrations() {
  console.log('Verifying PostgreSQL schema tables...');
  
  // 1. Categories
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      description TEXT,
      color VARCHAR(50)
    )
  `);

  // 2. Suppliers
  await pool.query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      contact_name VARCHAR(100),
      email VARCHAR(150),
      phone VARCHAR(50),
      address TEXT
    )
  `);

  // 3. Zones
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zones (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      max_capacity INT,
      color VARCHAR(50)
    )
  `);

  // 4. Items
  await pool.query(`
    CREATE TABLE IF NOT EXISTS items (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      sku VARCHAR(100) NOT NULL UNIQUE,
      category VARCHAR(100) REFERENCES categories(name) ON UPDATE CASCADE,
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
      notes TEXT
    )
  `);

  // 5. Transactions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id VARCHAR(50) PRIMARY KEY,
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

  // Seed data if empty
  const catCheck = await pool.query('SELECT COUNT(*) FROM categories');
  if (parseInt(catCheck.rows[0].count, 10) === 0) {
    console.log('Seeding initial categories...');
    for (const cat of INITIAL_CATEGORIES) {
      await pool.query(
        'INSERT INTO categories (id, name, description, color) VALUES ($1, $2, $3, $4)',
        [cat.id, cat.name, cat.description, cat.color]
      );
    }
  }

  const supCheck = await pool.query('SELECT COUNT(*) FROM suppliers');
  if (parseInt(supCheck.rows[0].count, 10) === 0) {
    console.log('Seeding initial suppliers...');
    for (const s of INITIAL_SUPPLIERS) {
      await pool.query(
        'INSERT INTO suppliers (id, name, contact_name, email, phone, address) VALUES ($1, $2, $3, $4, $5, $6)',
        [s.id, s.name, s.contactName, s.email, s.phone, s.address]
      );
    }
  }

  const zoneCheck = await pool.query('SELECT COUNT(*) FROM zones');
  if (parseInt(zoneCheck.rows[0].count, 10) === 0) {
    console.log('Seeding initial zones...');
    for (const z of INITIAL_ZONES) {
      await pool.query(
        'INSERT INTO zones (id, name, description, max_capacity, color) VALUES ($1, $2, $3, $4, $5)',
        [z.id, z.name, z.description, z.maxCapacity, z.color]
      );
    }
  }

  const itemCheck = await pool.query('SELECT COUNT(*) FROM items');
  if (parseInt(itemCheck.rows[0].count, 10) === 0) {
    console.log('Seeding initial inventory items...');
    for (const item of INITIAL_ITEMS) {
      await pool.query(
        `INSERT INTO items (id, name, sku, category, quantity, unit, price, zone, aisle, shelf, bin, supplier_id, min_threshold, last_updated, notes) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          item.id,
          item.name,
          item.sku,
          item.category,
          item.quantity,
          item.unit,
          item.price,
          item.warehouseLocation.zone,
          item.warehouseLocation.aisle,
          item.warehouseLocation.shelf,
          item.warehouseLocation.bin,
          item.supplierId,
          item.minThreshold,
          item.lastUpdated,
          item.notes || ''
        ]
      );
    }
  }

  const txCheck = await pool.query('SELECT COUNT(*) FROM transactions');
  if (parseInt(txCheck.rows[0].count, 10) === 0) {
    console.log('Seeding initial stock transactions...');
    for (const tx of INITIAL_TRANSACTIONS) {
      await pool.query(
        `INSERT INTO transactions (id, item_id, item_name, sku, type, quantity, reason, timestamp, operator) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          tx.id,
          tx.itemId,
          tx.itemName,
          tx.sku,
          tx.type,
          tx.quantity,
          tx.reason,
          tx.timestamp,
          tx.operator
        ]
      );
    }
  }

  console.log('PostgreSQL database migration and seed completed successfully.');
}

// DB Query Methods
export async function getCategories() {
  if (usePostgres) {
    const res = await pool.query('SELECT * FROM categories');
    return res.rows;
  }
  return memCategories;
}

export async function getSuppliers() {
  if (usePostgres) {
    const res = await pool.query('SELECT * FROM suppliers');
    return res.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      contactName: row.contact_name,
      email: row.email,
      phone: row.phone,
      address: row.address,
    }));
  }
  return memSuppliers;
}

export async function getZones() {
  if (usePostgres) {
    const res = await pool.query('SELECT * FROM zones');
    return res.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      maxCapacity: row.max_capacity,
      color: row.color,
    }));
  }
  return memZones;
}

export async function getItems() {
  if (usePostgres) {
    const res = await pool.query('SELECT * FROM items ORDER BY last_updated DESC');
    return res.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      sku: row.sku,
      category: row.category,
      quantity: row.quantity,
      unit: row.unit,
      price: parseFloat(row.price),
      warehouseLocation: {
        zone: row.zone,
        aisle: row.aisle,
        shelf: row.shelf,
        bin: row.bin,
      },
      supplierId: row.supplier_id,
      minThreshold: row.min_threshold,
      lastUpdated: row.last_updated.toISOString(),
      notes: row.notes,
    }));
  }
  return memItems;
}

export async function getTransactions() {
  if (usePostgres) {
    const res = await pool.query('SELECT * FROM transactions ORDER BY timestamp DESC');
    return res.rows.map((row: any) => ({
      id: row.id,
      itemId: row.item_id,
      itemName: row.item_name,
      sku: row.sku,
      type: row.type,
      quantity: row.quantity,
      reason: row.reason,
      timestamp: row.timestamp.toISOString(),
      operator: row.operator,
    }));
  }
  return memTransactions;
}

export async function saveItem(item: any) {
  if (usePostgres) {
    await pool.query(
      `INSERT INTO items (id, name, sku, category, quantity, unit, price, zone, aisle, shelf, bin, supplier_id, min_threshold, last_updated, notes) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        item.id,
        item.name,
        item.sku,
        item.category,
        item.quantity,
        item.unit,
        item.price,
        item.warehouseLocation.zone,
        item.warehouseLocation.aisle,
        item.warehouseLocation.shelf,
        item.warehouseLocation.bin,
        item.supplierId,
        item.minThreshold,
        item.lastUpdated,
        item.notes || ''
      ]
    );
  } else {
    memItems.unshift(item);
  }
}

export async function updateItem(id: string, item: any) {
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
       WHERE id = $15`,
      [
        item.name,
        item.sku,
        item.category,
        item.quantity,
        item.unit,
        item.price,
        item.warehouseLocation.zone,
        item.warehouseLocation.aisle,
        item.warehouseLocation.shelf,
        item.warehouseLocation.bin,
        item.supplierId,
        item.minThreshold,
        item.lastUpdated,
        item.notes || '',
        id
      ]
    );
  } else {
    memItems = memItems.map(i => i.id === id ? { ...i, ...item } : i);
  }
}

export async function deleteItem(id: string) {
  if (usePostgres) {
    await pool.query('DELETE FROM items WHERE id = $1', [id]);
  } else {
    memItems = memItems.filter(i => i.id !== id);
  }
}

export async function saveTransaction(tx: any) {
  if (usePostgres) {
    await pool.query(
      `INSERT INTO transactions (id, item_id, item_name, sku, type, quantity, reason, timestamp, operator) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        tx.id,
        tx.itemId,
        tx.itemName,
        tx.sku,
        tx.type,
        tx.quantity,
        tx.reason,
        tx.timestamp,
        tx.operator
      ]
    );
  } else {
    memTransactions.unshift(tx);
  }
}

export async function resetDb() {
  if (usePostgres) {
    console.log('Resetting and re-seeding database...');
    await pool.query('TRUNCATE TABLE transactions, items CASCADE');
    await pool.query('TRUNCATE TABLE categories, suppliers, zones CASCADE');
    await runMigrations();
  } else {
    memItems = [...INITIAL_ITEMS];
    memTransactions = [...INITIAL_TRANSACTIONS];
    memSuppliers = [...INITIAL_SUPPLIERS];
    memCategories = [...INITIAL_CATEGORIES];
    memZones = [...INITIAL_ZONES];
  }
}
