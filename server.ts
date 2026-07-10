import express from 'express';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { 
  initDb, 
  getItems, 
  getTransactions, 
  getSuppliers, 
  saveSupplier,
  getCategories, 
  saveCategory,
  deleteCategory,
  getZones, 
  saveZone,
  deleteZone,
  saveItem, 
  updateItem, 
  deleteItem, 
  saveTransaction, 
  resetDb,
  createUser,
  findUserByEmail,
  createWarehouse,
  findWarehouseByCode,
  findWarehouseById,
  seedWarehouseData,
  associateUserWithWarehouse,
  getUserWarehouses,
  isUserInWarehouse,
  updateUserActiveWarehouse,
  wipeWarehouseAndAccount,
  getUserRoleInWarehouse,
  updateWarehouse,
  getWarehouseUsers,
  updateWarehouseUserRole,
  removeUserFromWarehouse,
  inviteUserToWarehouse
} from './server-db.js';

function resolveJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'FATAL: JWT_SECRET environment variable is required in production. ' +
      'Refusing to start with a hardcoded/default secret. Set JWT_SECRET in your .env file.'
    );
  }
  console.warn('⚠️  JWT_SECRET not set - using an insecure development-only default. Never deploy this way.');
  return 'dev-only-insecure-secret-do-not-use-in-production';
}

const JWT_SECRET = resolveJwtSecret();

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
  
  // Configure the port: runs on PORT (3000) inside AI Studio
  const PORT = parseInt(process.env.PORT || '3000', 10);

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
      await associateUserWithWarehouse(newUser.id, warehouseId);

      const token = jwt.sign(
        { id: newUser.id, email: newUser.email, name: newUser.name, warehouseId },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.status(201).json({
        token,
        user: { id: newUser.id, email: newUser.email, name: newUser.name },
        warehouse: warehouseDetails,
        warehouses: [warehouseDetails]
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
      const warehousesList = await getUserWarehouses(user.id);
      
      // Fallback association for seed / existing users
      if (warehousesList.length === 0 && user.warehouseId) {
        await associateUserWithWarehouse(user.id, user.warehouseId);
        const mappedWh = await findWarehouseById(user.warehouseId);
        if (mappedWh) {
          warehousesList.push(mappedWh);
        }
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, name: user.name, warehouseId: user.warehouseId },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.json({
        token,
        user: { id: user.id, email: user.email, name: user.name },
        warehouse,
        warehouses: warehousesList
      });
    } catch (err: any) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Failed to authenticate user.', details: err.message });
    }
  });

  // Google & Facebook OAuth Login / Registration - DISABLED.
  //
  // The previous implementation trusted a client-supplied email/provider/providerId
  // with no server-side verification against Google or Facebook. That meant anyone
  // could POST an existing user's email with a made-up providerId and be logged in
  // as that user, no password required - a full account-takeover bug. The frontend
  // never implemented real SSO either; it simulated a fixed demo login.
  //
  // Real SSO requires verifying a genuine Google ID token (e.g. via
  // google-auth-library's OAuth2Client.verifyIdToken) or a genuine Facebook access
  // token (via the Graph API /debug_token endpoint) server-side, using OAuth
  // client credentials you register with each provider for this exact domain.
  // Wire that up here once you have those credentials - do not re-enable this
  // endpoint without real token verification.
  app.post('/api/auth/oauth', async (req, res) => {
    res.status(501).json({ error: 'Social sign-in is not yet available. Please use email and password.' });
  });

  // --- Secure Scoped Data API Endpoints ---

  // Fetch all warehouses for the authenticated operator (max 2)
  app.get('/api/auth/warehouses', authenticateToken, async (req: any, res) => {
    try {
      const warehousesList = await getUserWarehouses(req.user.id);
      res.json({ warehouses: warehousesList });
    } catch (err: any) {
      console.error('Error fetching warehouses:', err);
      res.status(500).json({ error: 'Failed to retrieve warehouses associated with your account.', details: err.message });
    }
  });

  // Create an additional warehouse (max 2 warehouses per account)
  app.post('/api/auth/warehouses/create', authenticateToken, async (req: any, res) => {
    try {
      const { name, address } = req.body;
      if (!name) {
        res.status(400).json({ error: 'Warehouse designation is required.' });
        return;
      }

      // Check current count
      const existing = await getUserWarehouses(req.user.id);
      if (existing.length >= 2) {
        res.status(400).json({ error: 'Maximum limit of 2 warehouses has been reached for this account.' });
        return;
      }

      const warehouseId = `wh-${Date.now()}`;
      const code = `WH-${Math.floor(100000 + Math.random() * 900000)}`;
      const warehouseDetails = await createWarehouse({
        id: warehouseId,
        name,
        code,
        address: address || ''
      });

      // Seed default dataset
      await seedWarehouseData(warehouseId);

      // Associate
      await associateUserWithWarehouse(req.user.id, warehouseId);

      // Set active
      await updateUserActiveWarehouse(req.user.id, warehouseId);

      // Issue new token with updated active warehouseId
      const token = jwt.sign(
        { id: req.user.id, email: req.user.email, name: req.user.name, warehouseId },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.status(201).json({
        status: 'success',
        token,
        warehouse: warehouseDetails,
        warehouses: await getUserWarehouses(req.user.id)
      });
    } catch (err: any) {
      console.error('Error creating additional warehouse:', err);
      res.status(500).json({ error: 'Failed to create warehouse.', details: err.message });
    }
  });

  // Join an existing warehouse via access clearance code (max 2 warehouses per account)
  app.post('/api/auth/warehouses/join', authenticateToken, async (req: any, res) => {
    try {
      const { code } = req.body;
      if (!code) {
        res.status(400).json({ error: 'Warehouse clearance access code is required.' });
        return;
      }

      // Check current count
      const existing = await getUserWarehouses(req.user.id);
      if (existing.length >= 2) {
        res.status(400).json({ error: 'Maximum limit of 2 warehouses has been reached for this account.' });
        return;
      }

      const matchedWh = await findWarehouseByCode(code);
      if (!matchedWh) {
        res.status(404).json({ error: 'Warehouse access code not found.' });
        return;
      }

      // Check if already member
      const isAlreadyMember = existing.some((w: any) => w.id === matchedWh.id);
      if (isAlreadyMember) {
        res.status(400).json({ error: 'You are already connected to this warehouse.' });
        return;
      }

      // Associate
      await associateUserWithWarehouse(req.user.id, matchedWh.id);

      // Set active
      await updateUserActiveWarehouse(req.user.id, matchedWh.id);

      // Issue new token with updated active warehouseId
      const token = jwt.sign(
        { id: req.user.id, email: req.user.email, name: req.user.name, warehouseId: matchedWh.id },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.json({
        status: 'success',
        token,
        warehouse: matchedWh,
        warehouses: await getUserWarehouses(req.user.id)
      });
    } catch (err: any) {
      console.error('Error joining warehouse:', err);
      res.status(500).json({ error: 'Failed to join warehouse.', details: err.message });
    }
  });

  // Switch active warehouse
  app.post('/api/auth/warehouses/switch', authenticateToken, async (req: any, res) => {
    try {
      const { warehouseId } = req.body;
      if (!warehouseId) {
        res.status(400).json({ error: 'Target warehouse ID is required.' });
        return;
      }

      // Verify the user is associated with this warehouse
      const isMember = await isUserInWarehouse(req.user.id, warehouseId);
      if (!isMember) {
        res.status(403).json({ error: 'You do not have clearance to access this warehouse.' });
        return;
      }

      const warehouseDetails = await findWarehouseById(warehouseId);
      if (!warehouseDetails) {
        res.status(404).json({ error: 'Warehouse not found.' });
        return;
      }

      // Set active
      await updateUserActiveWarehouse(req.user.id, warehouseId);

      // Issue new token with updated active warehouseId
      const token = jwt.sign(
        { id: req.user.id, email: req.user.email, name: req.user.name, warehouseId },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.json({
        status: 'success',
        token,
        warehouse: warehouseDetails,
        warehouses: await getUserWarehouses(req.user.id)
      });
    } catch (err: any) {
      console.error('Error switching active warehouse:', err);
      res.status(500).json({ error: 'Failed to switch warehouse context.', details: err.message });
    }
  });

  // Retrieve the entire warehouse dataset (items, transactions, suppliers, categories, zones, warehouse settings, user roles) scoped to user's warehouse
  app.get('/api/data', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      const [items, transactions, suppliers, categories, zones, warehouse, userRole, warehouseUsers] = await Promise.all([
        getItems(warehouseId),
        getTransactions(warehouseId),
        getSuppliers(warehouseId),
        getCategories(warehouseId),
        getZones(warehouseId),
        findWarehouseById(warehouseId),
        getUserRoleInWarehouse(req.user.id, warehouseId),
        getWarehouseUsers(warehouseId)
      ]);
      res.json({ items, transactions, suppliers, categories, zones, warehouse, userRole, warehouseUsers });
    } catch (err: any) {
      console.error('Error fetching data:', err);
      res.status(500).json({ error: 'Failed to fetch warehouse dataset', details: err.message });
    }
  });

  // Create a new supplier in the user's registered warehouse
  app.post('/api/suppliers', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      
      // Permission check: admin/manager only
      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role !== 'admin' && role !== 'manager') {
        res.status(403).json({ error: 'Access denied: Only Administrators and Managers can add suppliers.' });
        return;
      }

      const supplier = req.body;
      if (!supplier.name) {
        res.status(400).json({ error: 'Missing required supplier name' });
        return;
      }

      if (!supplier.id) {
        supplier.id = `sup-${Date.now()}`;
      }

      await saveSupplier(supplier, warehouseId);

      res.status(201).json({ status: 'success', supplier });
    } catch (err: any) {
      console.error('Error saving supplier:', err);
      res.status(500).json({ error: 'Failed to save supplier', details: err.message });
    }
  });

  // Create or update a zone in the user's registered warehouse
  app.post('/api/zones', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      
      // Permission check: admin/manager only
      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role !== 'admin' && role !== 'manager') {
        res.status(403).json({ error: 'Access denied: Only Administrators and Managers can add zones.' });
        return;
      }

      const zone = req.body;
      if (!zone.name) {
        res.status(400).json({ error: 'Missing required zone name' });
        return;
      }

      if (!zone.id) {
        const cleanName = zone.name.trim().replace(/\s+/g, '-');
        zone.id = `${cleanName}-${Date.now()}`;
      }

      await saveZone(zone, warehouseId);

      res.status(201).json({ status: 'success', zone });
    } catch (err: any) {
      console.error('Error saving zone:', err);
      res.status(500).json({ error: 'Failed to save zone', details: err.message });
    }
  });

  // Delete a zone from the user's registered warehouse
  app.delete('/api/zones/:id', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      
      // Permission check: admin/manager only
      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role !== 'admin' && role !== 'manager') {
        res.status(403).json({ error: 'Access denied: Only Administrators and Managers can delete zones.' });
        return;
      }

      const zoneId = req.params.id;
      await deleteZone(zoneId, warehouseId);

      res.json({ status: 'success' });
    } catch (err: any) {
      console.error('Error deleting zone:', err);
      res.status(500).json({ error: 'Failed to delete zone', details: err.message });
    }
  });

  // Create or update a category in the user's registered warehouse
  app.post('/api/categories', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      
      // Permission check: admin/manager only
      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role !== 'admin' && role !== 'manager') {
        res.status(403).json({ error: 'Access denied: Only Administrators and Managers can manage categories.' });
        return;
      }

      const category = req.body;
      if (!category.name) {
        res.status(400).json({ error: 'Missing required category name' });
        return;
      }

      if (!category.id) {
        const cleanName = category.name.trim().replace(/\s+/g, '-').toLowerCase();
        category.id = `${cleanName}-${Date.now()}`;
      }

      await saveCategory(category, warehouseId);

      res.status(201).json({ status: 'success', category });
    } catch (err: any) {
      console.error('Error saving category:', err);
      res.status(500).json({ error: 'Failed to save category', details: err.message });
    }
  });

  // Delete a category from the user's registered warehouse
  app.delete('/api/categories/:id', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      
      // Permission check: admin/manager only
      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role !== 'admin' && role !== 'manager') {
        res.status(403).json({ error: 'Access denied: Only Administrators and Managers can delete categories.' });
        return;
      }

      const categoryId = req.params.id;
      await deleteCategory(categoryId, warehouseId);

      res.json({ status: 'success' });
    } catch (err: any) {
      console.error('Error deleting category:', err);
      res.status(500).json({ error: 'Failed to delete category', details: err.message });
    }
  });

  // Create a new inventory item inside the user's registered warehouse
  app.post('/api/items', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      
      // Permission check: admin/manager only
      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role !== 'admin' && role !== 'manager') {
        res.status(403).json({ error: 'Access denied: Only Administrators and Managers can add new catalog items.' });
        return;
      }

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

      // Permission check: admin/manager only
      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role !== 'admin' && role !== 'manager') {
        res.status(403).json({ error: 'Access denied: Only Administrators and Managers can update catalog items.' });
        return;
      }

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

      // Permission check: admin/manager only
      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role !== 'admin' && role !== 'manager') {
        res.status(403).json({ error: 'Access denied: Only Administrators and Managers can delete catalog items.' });
        return;
      }

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

      // Permission check: viewers are read-only
      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role === 'viewer') {
        res.status(403).json({ error: 'Access denied: Viewers are not permitted to log inventory adjustments.' });
        return;
      }

      const { itemId, type, quantity, reason, operator, issuedTo } = req.body;
      if (!itemId || !type || !quantity) {
        res.status(400).json({ error: 'Missing adjustment parameters' });
        return;
      }

      if (type === 'OUTBOUND' && (!issuedTo || !issuedTo.trim())) {
        res.status(400).json({ error: 'Outbound shipments must be issued to an engineer or another connected warehouse.' });
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

      const finalReason = type === 'OUTBOUND' && issuedTo ? `${reason} [Issued to: ${issuedTo}]` : reason;

      // Create transaction record
      const transaction = {
        id: `tx-adjust-${Date.now()}`,
        itemId: item.id,
        itemName: item.name,
        sku: item.sku,
        type,
        quantity: qty,
        reason: finalReason,
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

      // Permission check: viewers are read-only
      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role === 'viewer') {
        res.status(403).json({ error: 'Access denied: Viewers are not permitted to log procurement restocks.' });
        return;
      }

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

  // --- Warehouse Details & Layout Setup Endpoint ---
  app.put('/api/warehouse', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;

      // Permission check: admin only
      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role !== 'admin') {
        res.status(403).json({ error: 'Access denied: Only Administrators can edit warehouse setup and details.' });
        return;
      }

      const { name, address, email, phone, contact_name, layout_rows, layout_cols, layout_zones } = req.body;
      if (!name) {
        res.status(400).json({ error: 'Warehouse name is required.' });
        return;
      }

      const updated = await updateWarehouse(warehouseId, {
        name,
        address,
        email,
        phone,
        contact_name,
        layout_rows: Number(layout_rows ?? 5),
        layout_cols: Number(layout_cols ?? 5),
        layout_zones: typeof layout_zones === 'string' ? layout_zones : JSON.stringify(layout_zones || [])
      });

      res.json({ status: 'success', message: 'Warehouse configuration updated successfully.', warehouse: updated });
    } catch (err: any) {
      console.error('Error updating warehouse:', err);
      res.status(500).json({ error: 'Failed to update warehouse settings.', details: err.message });
    }
  });

  // --- Invite/Add User to Warehouse Endpoint ---
  app.post('/api/warehouse/users', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;

      // Permission check: admin only
      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role !== 'admin') {
        res.status(403).json({ error: 'Access denied: Only Administrators can manage warehouse operator accounts.' });
        return;
      }

      const { email, name, role: targetRole } = req.body;
      if (!email) {
        res.status(400).json({ error: 'Operator email is required.' });
        return;
      }

      const { user, isNewUser, tempPassword } = await inviteUserToWarehouse(warehouseId, email, name, targetRole || 'operator');
      const updatedUsersList = await getWarehouseUsers(warehouseId);

      res.status(201).json({
        status: 'success',
        message: isNewUser
          ? `Account created for new operator ${email}. Temporary password: ${tempPassword} (share this securely - it won't be shown again).`
          : `Existing account for ${email} has been associated with your warehouse.`,
        tempPassword: isNewUser ? tempPassword : undefined,
        users: updatedUsersList
      });
    } catch (err: any) {
      console.error('Error adding user:', err);
      res.status(500).json({ error: 'Failed to add operator account to warehouse.', details: err.message });
    }
  });

  // --- Edit Member User Role Endpoint ---
  app.put('/api/warehouse/users/:userId', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      const { userId } = req.params;
      const { role: targetRole } = req.body;

      // Permission check: admin only
      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role !== 'admin') {
        res.status(403).json({ error: 'Access denied: Only Administrators can edit operator roles.' });
        return;
      }

      if (userId === req.user.id) {
        res.status(400).json({ error: 'You cannot change your own Administrator permissions.' });
        return;
      }

      await updateWarehouseUserRole(warehouseId, userId, targetRole || 'operator');
      const updatedUsersList = await getWarehouseUsers(warehouseId);

      res.json({
        status: 'success',
        message: 'Operator permissions updated successfully.',
        users: updatedUsersList
      });
    } catch (err: any) {
      console.error('Error updating user role:', err);
      res.status(500).json({ error: 'Failed to update operator role.', details: err.message });
    }
  });

  // --- Remove Member User Endpoint ---
  app.delete('/api/warehouse/users/:userId', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      const { userId } = req.params;

      // Permission check: admin only
      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role !== 'admin') {
        res.status(403).json({ error: 'Access denied: Only Administrators can remove operators.' });
        return;
      }

      if (userId === req.user.id) {
        res.status(400).json({ error: 'You cannot remove yourself from your active warehouse.' });
        return;
      }

      await removeUserFromWarehouse(warehouseId, userId);
      const updatedUsersList = await getWarehouseUsers(warehouseId);

      res.json({
        status: 'success',
        message: 'Operator has been removed from this warehouse space.',
        users: updatedUsersList
      });
    } catch (err: any) {
      console.error('Error removing user:', err);
      res.status(500).json({ error: 'Failed to remove operator account from warehouse.', details: err.message });
    }
  });

  // Reset database back to default dataset (clears items and transactions and seeds them)
  app.post('/api/reset', authenticateToken, async (req: any, res) => {
    try {
      const { password } = req.body;
      if (!password) {
        res.status(400).json({ error: 'Password confirmation is required to reset the database.' });
        return;
      }

      const user = await findUserByEmail(req.user.email);
      if (!user) {
        res.status(404).json({ error: 'User account not found.' });
        return;
      }

      let isVerified = false;
      if (user.passwordHash) {
        isVerified = await bcrypt.compare(password, user.passwordHash);
      } else {
        const normPass = password.trim().toLowerCase();
        isVerified = (normPass === 'oauth' || normPass === 'confirm' || normPass === 'reset' || normPass === user.email.toLowerCase());
      }

      if (!isVerified) {
        res.status(401).json({ error: 'Incorrect verification password. Authorization denied.' });
        return;
      }

      const warehouseId = req.user.warehouseId;
      await resetDb(warehouseId);
      res.json({ status: 'success', message: 'Warehouse dataset reset completed successfully' });
    } catch (err: any) {
      console.error('Error resetting database:', err);
      res.status(500).json({ error: 'Failed to reset database', details: err.message });
    }
  });

  // Permanently delete the caller's own account and their warehouse data.
  // SECURITY: This must stay authenticated + admin-scoped + tenant-scoped.
  // It intentionally does NOT touch other tenants' data - a login-gated button
  // that could wipe every customer's warehouse would defeat multi-tenancy
  // entirely. A true whole-system wipe is a DB-operator action (see
  // scripts/reset-production-data.sql), not something reachable over HTTP.
  app.post('/api/account/wipe-my-data', authenticateToken, async (req: any, res) => {
    try {
      const { password, confirm } = req.body;
      if (confirm !== 'WIPE') {
        res.status(400).json({ error: 'You must type WIPE to confirm this irreversible action.' });
        return;
      }

      const warehouseId = req.user.warehouseId;
      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role !== 'admin') {
        res.status(403).json({ error: 'Access denied: Only Administrators can delete a warehouse and its data.' });
        return;
      }

      const user = await findUserByEmail(req.user.email);
      if (!user) {
        res.status(404).json({ error: 'User account not found.' });
        return;
      }

      // Re-verify identity before a destructive action, same as the scoped reset flow.
      let isVerified = false;
      if (user.passwordHash) {
        if (!password) {
          res.status(400).json({ error: 'Password confirmation is required.' });
          return;
        }
        isVerified = await bcrypt.compare(password, user.passwordHash);
      } else {
        const normPass = (password || '').trim().toLowerCase();
        isVerified = (normPass === 'confirm' || normPass === 'reset' || normPass === user.email.toLowerCase());
      }

      if (!isVerified) {
        res.status(401).json({ error: 'Incorrect verification password. Authorization denied.' });
        return;
      }

      await wipeWarehouseAndAccount(req.user.id, warehouseId);
      res.json({ status: 'success', message: 'Your warehouse data and account have been permanently deleted.' });
    } catch (err: any) {
      console.error('Error wiping account/warehouse data:', err);
      res.status(500).json({ error: 'Failed to delete account and warehouse data.', details: err.message });
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
    // Serve static compiled UI files in production, if this container has
    // them. In a split-container deployment (separate frontend/backend
    // images), this backend container only has dist/server.cjs - the
    // frontend container serves the built UI instead, so there's nothing to
    // fall back to here beyond the API routes already registered above.
    const distPath = path.join(process.cwd(), 'dist');
    const indexPath = path.join(distPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      app.use(express.static(distPath));
      app.get('*all', (req, res) => {
        res.sendFile(indexPath);
      });
    } else {
      app.get('*all', (req, res) => {
        res.status(404).json({ error: 'API server only - no frontend bundled in this container.' });
      });
    }
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
