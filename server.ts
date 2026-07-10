import express from 'express';
import path from 'path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { 
  initDb, 
  getItems, 
  getTransactions, 
  getSuppliers, 
  getCategories, 
  getZones, 
  saveItem, 
  updateItem, 
  deleteItem, 
  saveTransaction, 
  resetDb,
  createUser,
  findUserByEmail,
  findUserByOAuth,
  createWarehouse,
  findWarehouseByCode,
  findWarehouseById,
  seedWarehouseData
} from './server-db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'siwm-production-secure-key-2026';

// Middleware to authenticate JWT access tokens
function authenticateToken(req: any, res: any, next: any) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Access token required. Please sign in.' });
    return;
  }

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) {
      res.status(403).json({ error: 'Session expired or invalid token. Please sign in again.' });
      return;
    }
    req.user = user;
    next();
  });
}

async function startServer() {
  const app = express();
  
  // Configure the port: runs on PORT (3000) inside AI Studio, but defaults to 4001 in the user's container
  const PORT = parseInt(process.env.PORT || '4001', 10);

  // Middleware for parsing JSON requests
  app.use(express.json());

  // Initialize PostgreSQL database connection and migrations
  await initDb();

  // --- Public API Endpoints ---
  
  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
  });

  // --- Authentication & Multi-Tenant Registry Endpoints ---

  // Register a new user account + create or join a warehouse tenant
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, password, name, warehouseOption, warehouseName, warehouseAddress, warehouseCode } = req.body;
      
      if (!email || !name) {
        res.status(400).json({ error: 'Email and Name are required.' });
        return;
      }

      // Normalize email
      const normEmail = email.toLowerCase().trim();

      // Check if user already exists
      const existingUser = await findUserByEmail(normEmail);
      if (existingUser) {
        res.status(400).json({ error: 'An account with this email already exists.' });
        return;
      }

      let warehouseId = '';
      let warehouseDetails: any = null;

      if (warehouseOption === 'create') {
        if (!warehouseName) {
          res.status(400).json({ error: 'Warehouse name is required to create a new warehouse.' });
          return;
        }
        warehouseId = `wh-${Date.now()}`;
        // Generate code: e.g. WH-123456
        const code = `WH-${Math.floor(100000 + Math.random() * 900000)}`;
        warehouseDetails = await createWarehouse({
          id: warehouseId,
          name: warehouseName,
          code,
          address: warehouseAddress || ''
        });
        // Seed default dataset for this warehouse so they have a fully functioning baseline setup
        await seedWarehouseData(warehouseId);
      } else if (warehouseOption === 'join') {
        if (!warehouseCode) {
          res.status(400).json({ error: 'Warehouse access code is required to join.' });
          return;
        }
        const matchedWh = await findWarehouseByCode(warehouseCode);
        if (!matchedWh) {
          res.status(404).json({ error: 'Warehouse access code not found. Please verify and try again.' });
          return;
        }
        warehouseId = matchedWh.id;
        warehouseDetails = matchedWh;
      } else {
        res.status(400).json({ error: 'Invalid warehouse selection option.' });
        return;
      }

      const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;
      const newUser = {
        id: `usr-${Date.now()}`,
        email: normEmail,
        passwordHash,
        name,
        warehouseId,
        provider: 'email'
      };

      await createUser(newUser);

      const token = jwt.sign(
        { id: newUser.id, email: newUser.email, name: newUser.name, warehouseId },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.status(201).json({
        token,
        user: { id: newUser.id, email: newUser.email, name: newUser.name },
        warehouse: warehouseDetails
      });
    } catch (err: any) {
      console.error('Registration error:', err);
      res.status(500).json({ error: 'Failed to complete registration.', details: err.message });
    }
  });

  // Login via Email & Password
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ error: 'Email and Password are required.' });
        return;
      }

      const normEmail = email.toLowerCase().trim();
      const user = await findUserByEmail(normEmail);
      if (!user || user.provider !== 'email') {
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }

      const passwordMatch = await bcrypt.compare(password, user.passwordHash || '');
      if (!passwordMatch) {
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }

      const warehouse = await findWarehouseById(user.warehouseId || '');

      const token = jwt.sign(
        { id: user.id, email: user.email, name: user.name, warehouseId: user.warehouseId },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.json({
        token,
        user: { id: user.id, email: user.email, name: user.name },
        warehouse
      });
    } catch (err: any) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Failed to authenticate user.', details: err.message });
    }
  });

  // Handle Google & Facebook OAuth Login / Registration
  app.post('/api/auth/oauth', async (req, res) => {
    try {
      const { email, name, provider, providerId, warehouseOption, warehouseName, warehouseAddress, warehouseCode } = req.body;
      
      if (!email || !provider || !providerId) {
        res.status(400).json({ error: 'Missing OAuth identity parameters.' });
        return;
      }

      const normEmail = email.toLowerCase().trim();

      // 1. Try to find user by provider and providerId
      let user = await findUserByOAuth(provider, providerId);

      // 2. If not found by OAuth, try by email
      if (!user) {
        const emailUser = await findUserByEmail(normEmail);
        if (emailUser) {
          user = emailUser;
        }
      }

      let warehouseDetails: any = null;

      // 3. Register user if they do not exist
      if (!user) {
        let warehouseId = '';
        
        if (warehouseOption === 'join' && warehouseCode) {
          const matchedWh = await findWarehouseByCode(warehouseCode);
          if (!matchedWh) {
            res.status(404).json({ error: 'Warehouse access code not found.' });
            return;
          }
          warehouseId = matchedWh.id;
          warehouseDetails = matchedWh;
        } else {
          // Create a new custom warehouse for the OAuth user
          warehouseId = `wh-${Date.now()}`;
          const code = `WH-${Math.floor(100000 + Math.random() * 900000)}`;
          warehouseDetails = await createWarehouse({
            id: warehouseId,
            name: warehouseName || `${name}'s Operations Hub`,
            code,
            address: warehouseAddress || ''
          });
          await seedWarehouseData(warehouseId);
        }

        user = {
          id: `usr-${Date.now()}`,
          email: normEmail,
          name: name || 'OAuth User',
          warehouseId,
          provider,
          providerId
        } as any;

        await createUser(user);
      } else {
        warehouseDetails = await findWarehouseById(user.warehouseId || '');
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, name: user.name, warehouseId: user.warehouseId },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.json({
        token,
        user: { id: user.id, email: user.email, name: user.name },
        warehouse: warehouseDetails
      });
    } catch (err: any) {
      console.error('OAuth processing error:', err);
      res.status(500).json({ error: 'Failed to complete OAuth process.', details: err.message });
    }
  });

  // --- Secure Scoped Data API Endpoints ---

  // Retrieve the entire warehouse dataset (items, transactions, suppliers, categories, zones) scoped to user's warehouse
  app.get('/api/data', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      const [items, transactions, suppliers, categories, zones] = await Promise.all([
        getItems(warehouseId),
        getTransactions(warehouseId),
        getSuppliers(warehouseId),
        getCategories(warehouseId),
        getZones(warehouseId)
      ]);
      res.json({ items, transactions, suppliers, categories, zones });
    } catch (err: any) {
      console.error('Error fetching data:', err);
      res.status(500).json({ error: 'Failed to fetch warehouse dataset', details: err.message });
    }
  });

  // Create a new inventory item inside the user's registered warehouse
  app.post('/api/items', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      const item = req.body;
      if (!item.id || !item.name || !item.sku) {
        res.status(400).json({ error: 'Missing required item properties' });
        return;
      }

      await saveItem(item, warehouseId);

      // If initial quantity is greater than 0, log an ingestion transaction
      if (item.quantity > 0) {
        const newTx = {
          id: `tx-init-${Date.now()}`,
          itemId: item.id,
          itemName: item.name,
          sku: item.sku,
          type: 'INBOUND',
          quantity: item.quantity,
          reason: 'Initial Inventory Ingestion',
          timestamp: new Date().toISOString(),
          operator: req.user.name || 'System Operator'
        };
        await saveTransaction(newTx, warehouseId);
      }

      res.status(201).json({ status: 'success', item });
    } catch (err: any) {
      console.error('Error saving item:', err);
      res.status(500).json({ error: 'Failed to save item', details: err.message });
    }
  });

  // Update an existing inventory item in the user's registered warehouse
  app.put('/api/items/:id', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      const { id } = req.params;
      const item = req.body;
      if (!item.name || !item.sku) {
        res.status(400).json({ error: 'Missing required item properties' });
        return;
      }

      await updateItem(id, item, warehouseId);
      res.json({ status: 'success', item });
    } catch (err: any) {
      console.error('Error updating item:', err);
      res.status(500).json({ error: 'Failed to update item', details: err.message });
    }
  });

  // Decommission/delete an item from active inventory tracking
  app.delete('/api/items/:id', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      const { id } = req.params;
      await deleteItem(id, warehouseId);
      res.json({ status: 'success', message: `Item ${id} deleted` });
    } catch (err: any) {
      console.error('Error deleting item:', err);
      res.status(500).json({ error: 'Failed to delete item', details: err.message });
    }
  });

  // Handle inbound intake or outbound dispatch adjustments
  app.post('/api/adjust', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      const { itemId, type, quantity, reason, operator } = req.body;
      if (!itemId || !type || !quantity) {
        res.status(400).json({ error: 'Missing adjustment parameters' });
        return;
      }

      // Fetch items to verify stock levels
      const itemsList = await getItems(warehouseId);
      const itemIndex = itemsList.findIndex((i: any) => i.id === itemId);
      if (itemIndex === -1) {
        res.status(404).json({ error: 'Item not found in your warehouse' });
        return;
      }

      const item = itemsList[itemIndex];
      const qty = Number(quantity);
      if (type === 'OUTBOUND' && item.quantity < qty) {
        res.status(400).json({ error: 'Insufficient stock level to fulfill dispatch' });
        return;
      }

      const multiplier = type === 'INBOUND' ? 1 : -1;
      const updatedQty = item.quantity + (qty * multiplier);

      // Create updated item entity
      const updatedItem = {
        ...item,
        quantity: updatedQty,
        lastUpdated: new Date().toISOString()
      };

      // Create transaction record
      const transaction = {
        id: `tx-adjust-${Date.now()}`,
        itemId: item.id,
        itemName: item.name,
        sku: item.sku,
        type,
        quantity: qty,
        reason,
        timestamp: new Date().toISOString(),
        operator: operator || req.user.name || 'System Operator'
      };

      // Save changes to database
      await updateItem(item.id, updatedItem, warehouseId);
      await saveTransaction(transaction, warehouseId);

      res.json({ status: 'success', item: updatedItem, transaction });
    } catch (err: any) {
      console.error('Error executing adjustment:', err);
      res.status(500).json({ error: 'Failed to execute transaction', details: err.message });
    }
  });

  // Handle restock purchase orders transmitted from procurement planner
  app.post('/api/restock', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      const { supplierId, itemsToRestock } = req.body;
      if (!supplierId || !itemsToRestock || !Array.isArray(itemsToRestock)) {
        res.status(400).json({ error: 'Missing purchase order fields' });
        return;
      }

      const [itemsList, suppliersList] = await Promise.all([
        getItems(warehouseId), 
        getSuppliers(warehouseId)
      ]);
      const matchedSupplier = suppliersList.find((s: any) => s.id === supplierId);
      if (!matchedSupplier) {
        res.status(404).json({ error: 'Authorized supplier not found in your warehouse' });
        return;
      }

      const timestamp = new Date().toISOString();
      const updatedItems: any[] = [];
      const newTransactions: any[] = [];

      for (let idx = 0; idx < itemsToRestock.length; idx++) {
        const plan = itemsToRestock[idx];
        const matchedItem = itemsList.find((i: any) => i.id === plan.id);
        if (!matchedItem) continue;

        const updatedQty = matchedItem.quantity + plan.qty;
        const updatedItem = {
          ...matchedItem,
          quantity: updatedQty,
          lastUpdated: timestamp
        };

        const tx = {
          id: `tx-restock-${Date.now()}-${idx}`,
          itemId: plan.id,
          itemName: matchedItem.name,
          sku: matchedItem.sku,
          type: 'INBOUND',
          quantity: plan.qty,
          reason: `Automated Reorder: PO-${Math.floor(1000 + Math.random() * 9000)} via Planner`,
          timestamp,
          operator: `Procurement Bot (${matchedSupplier.name})`
        };

        await updateItem(matchedItem.id, updatedItem, warehouseId);
        await saveTransaction(tx, warehouseId);

        updatedItems.push(updatedItem);
        newTransactions.push(tx);
      }

      res.json({ status: 'success', updatedItems, newTransactions });
    } catch (err: any) {
      console.error('Error restocking items:', err);
      res.status(500).json({ error: 'Failed to execute procurement restock', details: err.message });
    }
  });

  // Reset database back to default dataset (clears items and transactions and seeds them)
  app.post('/api/reset', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      await resetDb(warehouseId);
      res.json({ status: 'success', message: 'Warehouse dataset reset completed successfully' });
    } catch (err: any) {
      console.error('Error resetting database:', err);
      res.status(500).json({ error: 'Failed to reset database', details: err.message });
    }
  });

  // --- Dev / Prod Static Asset Handlers ---

  if (process.env.NODE_ENV !== 'production') {
    // Integrate Vite as middleware in development
    const viteModule = 'vite';
    const { createServer } = await import(viteModule);
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    // Serve static compiled UI files in production
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Smart Warehouse Management System full-stack server`);
    console.log(`🟢 Running at: http://localhost:${PORT}`);
    console.log(`🌍 Network Access: http://0.0.0.0:${PORT}`);
    console.log(`======================================================\n`);
  });
}

startServer();
