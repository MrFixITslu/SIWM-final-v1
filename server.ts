import express from 'express';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
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
  archiveItem,
  saveTransaction, 
  adjustStockAtomic,
  restockAtomic,
  transferStockAtomic,
  getPurchaseOrders,
  savePurchaseOrder,
  updatePurchaseOrderStatus,
  receivePurchaseOrderPartial,
  deletePurchaseOrder,
  getZoneCapacity,
  verifyLiveUserAccess,
  resetDb,
  createUser,
  findUserByEmail,
  findUserById,
  changeUserPassword,
  logSystemAudit,
  getSystemAuditLogs,
  recordPersonnelDispatch,
  getPersonnelDispatches,
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

// Middleware to authenticate JWT access tokens with live membership validation
function authenticateToken(req: any, res: any, next: any) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Access token required. Please sign in.' });
    return;
  }

  jwt.verify(token, JWT_SECRET, async (err: any, decoded: any) => {
    if (err) {
      res.status(403).json({ error: 'Session expired or invalid token. Please sign in again.' });
      return;
    }
    
    // Validate live authorization against current tenant database
    try {
      const liveStatus = await verifyLiveUserAccess(decoded.id, decoded.warehouseId, decoded.tokenVersion);
      if (!liveStatus.valid) {
        if (liveStatus.reason === 'SESSION_REVOKED') {
          res.status(401).json({ error: 'Password was changed on this account. Please sign in with your new password.', code: 'SESSION_REVOKED' });
          return;
        }
        res.status(403).json({ error: 'Clearance revoked or membership is no longer active for this warehouse.' });
        return;
      }
      req.user = {
        ...decoded,
        role: liveStatus.role
      };
      next();
    } catch (checkErr) {
      req.user = decoded;
      next();
    }
  });
}

// Rate limiter for authentication routes
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 40, // 40 requests per 15 minutes per IP
  message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

async function startServer() {
  const app = express();
  
  // Configure HTTP Security Headers (relaxed CSP to permit Vite hot reload & iframe preview)
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  }));

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
  app.post('/api/auth/register', authRateLimiter, async (req, res) => {
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
        { id: newUser.id, email: newUser.email, name: newUser.name, warehouseId, tokenVersion: 1 },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      await logSystemAudit({
        warehouseId,
        action: 'USER_REGISTERED',
        category: 'USER',
        details: `New user account registered for ${newUser.email}.`,
        operator: newUser.name,
        operatorId: newUser.id,
        status: 'SUCCESS'
      });

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
  app.post('/api/auth/login', authRateLimiter, async (req, res) => {
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
        if (user.warehouseId) {
          await logSystemAudit({
            warehouseId: user.warehouseId,
            action: 'AUTH_LOGIN_FAILED',
            category: 'SECURITY',
            details: `Failed authentication attempt for ${user.email}.`,
            operator: user.email,
            status: 'FAILED'
          });
        }
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }

      // Check all accessible warehouses for this user
      const warehouses = await getUserWarehouses(user.id);
      if (warehouses.length === 0) {
        res.status(403).json({ error: 'No warehouse tenants associated with this account.' });
        return;
      }

      // Determine active warehouse (default to user's saved warehouseId or first available)
      const activeWhId = (user.warehouseId && warehouses.some((w: any) => w.id === user.warehouseId))
        ? user.warehouseId
        : warehouses[0].id;

      const activeWarehouse = warehouses.find((w: any) => w.id === activeWhId) || warehouses[0];

      const token = jwt.sign(
        { id: user.id, email: user.email, name: user.name, warehouseId: activeWhId, tokenVersion: user.tokenVersion || 1 },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      await logSystemAudit({
        warehouseId: activeWhId,
        action: 'AUTH_LOGIN_SUCCESS',
        category: 'SECURITY',
        details: `Successful login session initiated for ${user.email}.`,
        operator: user.name || user.email,
        operatorId: user.id,
        status: 'SUCCESS'
      });

      res.json({
        token,
        user: { id: user.id, email: user.email, name: user.name },
        warehouse: activeWarehouse,
        warehouses
      });
    } catch (err: any) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Failed to authenticate user.', details: err.message });
    }
  });

  // Change Password & Session Rotation (Self-Service)
  app.post('/api/auth/change-password', authenticateToken, async (req: any, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        res.status(400).json({ error: 'Current password and new password are required.' });
        return;
      }

      if (newPassword.length < 6) {
        res.status(400).json({ error: 'New password must be at least 6 characters long.' });
        return;
      }

      const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
      const result = await changeUserPassword(
        req.user.id,
        currentPassword,
        newPassword,
        req.user.warehouseId,
        typeof clientIp === 'string' ? clientIp : Array.isArray(clientIp) ? clientIp[0] : undefined
      );

      // Issue fresh JWT with updated tokenVersion
      const freshToken = jwt.sign(
        { id: req.user.id, email: req.user.email, name: req.user.name, warehouseId: req.user.warehouseId, tokenVersion: result.tokenVersion },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.json({
        status: 'success',
        message: 'Password updated successfully. All other active sessions have been rotated.',
        token: freshToken
      });
    } catch (err: any) {
      console.error('Password change error:', err);
      res.status(400).json({ error: err.message || 'Failed to change password.', details: err.message });
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

  // Retrieve the entire warehouse dataset (items, transactions, suppliers, categories, zones, warehouse settings, user roles, purchase orders, zone capacities) scoped to user's warehouse
  app.get('/api/data', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      const [items, transactions, suppliers, categories, zones, warehouse, userRole, warehouseUsers, purchaseOrders, zoneCapacities] = await Promise.all([
        getItems(warehouseId),
        getTransactions(warehouseId),
        getSuppliers(warehouseId),
        getCategories(warehouseId),
        getZones(warehouseId),
        findWarehouseById(warehouseId),
        getUserRoleInWarehouse(req.user.id, warehouseId),
        getWarehouseUsers(warehouseId),
        getPurchaseOrders(warehouseId),
        getZoneCapacity(warehouseId)
      ]);
      res.json({ items, transactions, suppliers, categories, zones, warehouse, userRole, warehouseUsers, purchaseOrders, zoneCapacities });
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

  // Archive or unarchive an item with audit logging
  app.post('/api/items/:id/archive', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;

      // Permission check: admin/manager only
      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role !== 'admin' && role !== 'manager') {
        res.status(403).json({ error: 'Access denied: Only Administrators and Managers can archive items.' });
        return;
      }

      const { id } = req.params;
      const { archive = true } = req.body;
      const updatedItem = await archiveItem(id, warehouseId, archive);

      // Log transaction for audit compliance
      const tx = {
        id: `tx-arch-${Date.now()}`,
        itemId: id,
        itemName: updatedItem?.name || id,
        sku: updatedItem?.sku || '',
        type: 'AUDIT',
        quantity: 0,
        reason: archive ? 'Item Archived / Decommissioned' : 'Item Restored / Unarchived',
        timestamp: new Date().toISOString(),
        operator: req.user.name || 'System Operator'
      };
      await saveTransaction(tx, warehouseId);

      res.json({ status: 'success', item: updatedItem, transaction: tx });
    } catch (err: any) {
      console.error('Error archiving item:', err);
      res.status(500).json({ error: 'Failed to update item archive state', details: err.message });
    }
  });

  // Handle inbound intake or outbound dispatch adjustments (atomic with concurrency lock)
  app.post('/api/adjust', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;

      // Permission check: viewers are read-only
      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role === 'viewer') {
        res.status(403).json({ error: 'Access denied: Viewers are not permitted to log inventory adjustments.' });
        return;
      }

      const { itemId, type, quantity, reason, operator, issuedTo, department, badgeNumber, projectCode, batchNumber } = req.body;
      if (!itemId || !type || !quantity) {
        res.status(400).json({ error: 'Missing adjustment parameters' });
        return;
      }

      if (type === 'OUTBOUND' && (!issuedTo || !issuedTo.trim())) {
        res.status(400).json({ error: 'Outbound shipments must be issued to an engineer, personnel, or destination unit.' });
        return;
      }

      const finalReason = reason || (type === 'INBOUND' ? 'Manual Inbound Intake' : `Outbound Dispatch (Issued to: ${issuedTo})`);
      const finalOperator = operator || req.user.name || 'System Operator';

      const result = await adjustStockAtomic(
        warehouseId,
        itemId,
        type,
        Number(quantity),
        finalReason,
        finalOperator,
        batchNumber
      );

      // Record direct personnel dispatch record if outbound
      if (type === 'OUTBOUND' && issuedTo) {
        await recordPersonnelDispatch({
          itemId,
          itemName: result.item?.name || result.transaction?.itemName || 'Item',
          sku: result.item?.sku || result.transaction?.sku || '',
          quantity: Number(quantity),
          recipientName: issuedTo,
          department: department || '',
          badgeNumber: badgeNumber || '',
          projectCode: projectCode || '',
          operator: finalOperator,
          notes: finalReason
        }, warehouseId);
      }

      await logSystemAudit({
        warehouseId,
        action: type === 'INBOUND' ? 'INVENTORY_INTAKE' : 'INVENTORY_DISPATCH',
        category: 'INVENTORY',
        details: `${type} adjustment: ${quantity} units for ${result.item?.name || itemId}. Reason: ${finalReason}`,
        operator: finalOperator,
        operatorId: req.user.id,
        status: 'SUCCESS'
      });

      res.json({ status: 'success', item: result.item, transaction: result.transaction });
    } catch (err: any) {
      console.error('Error executing adjustment:', err);
      res.status(400).json({ error: err.message || 'Failed to execute transaction', details: err.message });
    }
  });

  // Handle restock purchase orders transmitted from procurement planner (atomic)
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

      const result = await restockAtomic(
        warehouseId,
        itemsToRestock,
        req.user.name || 'System Operator',
        supplierId
      );

      await logSystemAudit({
        warehouseId,
        action: 'INVENTORY_RESTOCK',
        category: 'INVENTORY',
        details: `Procurement restock executed for ${itemsToRestock.length} item line(s).`,
        operator: req.user.name || 'System Operator',
        operatorId: req.user.id,
        status: 'SUCCESS'
      });

      res.json({ status: 'success', updatedItems: result.updatedItems, newTransactions: result.newTransactions });
    } catch (err: any) {
      console.error('Error restocking items:', err);
      res.status(400).json({ error: err.message || 'Failed to execute procurement restock', details: err.message });
    }
  });

  // Execute atomic inter-warehouse stock transfer
  app.post('/api/transfers', authenticateToken, async (req: any, res) => {
    try {
      const sourceWarehouseId = req.user.warehouseId;

      // Permission check: admin/manager/operator
      const role = await getUserRoleInWarehouse(req.user.id, sourceWarehouseId);
      if (role === 'viewer') {
        res.status(403).json({ error: 'Access denied: Viewers cannot execute inter-warehouse transfers.' });
        return;
      }

      const { targetWarehouseId, itemId, quantity, notes } = req.body;
      if (!targetWarehouseId || !itemId || !quantity || Number(quantity) <= 0) {
        res.status(400).json({ error: 'Source item, target warehouse, and a valid quantity are required.' });
        return;
      }

      if (sourceWarehouseId === targetWarehouseId) {
        res.status(400).json({ error: 'Target warehouse must be different from the source warehouse.' });
        return;
      }

      // Verify user has access to target warehouse or target warehouse exists
      const targetWh = await findWarehouseById(targetWarehouseId);
      if (!targetWh) {
        res.status(404).json({ error: 'Target warehouse tenant not found.' });
        return;
      }

      const result = await transferStockAtomic({
        userId: req.user.id,
        sourceWarehouseId,
        destWarehouseId: targetWarehouseId,
        itemId,
        quantity: Number(quantity),
        operator: req.user.name || 'System Operator',
        notes
      });

      await logSystemAudit({
        warehouseId: sourceWarehouseId,
        action: 'STOCK_TRANSFER_OUTBOUND',
        category: 'TRANSFER',
        details: `Transferred ${quantity} units of item ${itemId} to warehouse ${targetWh.name || targetWarehouseId}.`,
        operator: req.user.name || 'System Operator',
        operatorId: req.user.id,
        status: 'SUCCESS'
      });

      await logSystemAudit({
        warehouseId: targetWarehouseId,
        action: 'STOCK_TRANSFER_INBOUND',
        category: 'TRANSFER',
        details: `Received ${quantity} units from warehouse ${sourceWarehouseId}.`,
        operator: req.user.name || 'System Operator',
        operatorId: req.user.id,
        status: 'SUCCESS'
      });

      res.json({ status: 'success', ...result });
    } catch (err: any) {
      console.error('Error executing stock transfer:', err);
      res.status(400).json({ error: err.message || 'Failed to execute inter-warehouse transfer', details: err.message });
    }
  });

  // --- Purchase Orders Endpoints ---

  // Get all purchase orders for warehouse
  app.get('/api/purchase-orders', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      const purchaseOrders = await getPurchaseOrders(warehouseId);
      res.json({ purchaseOrders });
    } catch (err: any) {
      console.error('Error fetching purchase orders:', err);
      res.status(500).json({ error: 'Failed to retrieve purchase orders', details: err.message });
    }
  });

  // Create or update a purchase order
  app.post('/api/purchase-orders', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;

      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role === 'viewer') {
        res.status(403).json({ error: 'Access denied: Viewers cannot create purchase orders.' });
        return;
      }

      const poData = req.body;
      if (!poData.supplierId || !poData.items || !Array.isArray(poData.items) || poData.items.length === 0) {
        res.status(400).json({ error: 'Supplier and at least one line item are required.' });
        return;
      }

      const po = await savePurchaseOrder(poData, warehouseId);

      await logSystemAudit({
        warehouseId,
        action: 'PO_SAVED',
        category: 'PROCUREMENT',
        details: `Purchase order #${(po as any)?.poNumber || poData.poNumber} created/updated with ${poData.items.length} item(s).`,
        operator: req.user.name || 'System Operator',
        operatorId: req.user.id,
        status: 'SUCCESS'
      });

      res.status(201).json({ status: 'success', purchaseOrder: po });
    } catch (err: any) {
      console.error('Error saving purchase order:', err);
      res.status(500).json({ error: 'Failed to save purchase order', details: err.message });
    }
  });

  // Partial / Staged Receiving of Purchase Order Items
  app.post('/api/purchase-orders/:id/receive', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      const { id } = req.params;
      const { receivedItems } = req.body;

      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role === 'viewer') {
        res.status(403).json({ error: 'Access denied: Viewers cannot intake purchase orders.' });
        return;
      }

      if (!receivedItems || !Array.isArray(receivedItems) || receivedItems.length === 0) {
        res.status(400).json({ error: 'At least one item receipt record is required.' });
        return;
      }

      const result = await receivePurchaseOrderPartial(
        id,
        warehouseId,
        receivedItems,
        req.user.name || 'System Operator'
      );

      res.json({ ...result, status: 'success' });
    } catch (err: any) {
      console.error('Error receiving purchase order:', err);
      res.status(400).json({ error: err.message || 'Failed to receive purchase order', details: err.message });
    }
  });

  // Update purchase order status
  app.post('/api/purchase-orders/:id/status', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      const { id } = req.params;
      const { status } = req.body;

      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role === 'viewer') {
        res.status(403).json({ error: 'Access denied: Viewers cannot update purchase order statuses.' });
        return;
      }

      if (!status) {
        res.status(400).json({ error: 'Status is required.' });
        return;
      }

      const result = await updatePurchaseOrderStatus(id, warehouseId, status, req.user.name || 'System Operator');
      res.json({ status: 'success', result });
    } catch (err: any) {
      console.error('Error updating purchase order status:', err);
      res.status(400).json({ error: err.message || 'Failed to update purchase order status', details: err.message });
    }
  });

  // Delete/Cancel a draft purchase order
  app.delete('/api/purchase-orders/:id', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      const { id } = req.params;

      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role !== 'admin' && role !== 'manager') {
        res.status(403).json({ error: 'Access denied: Only Administrators and Managers can delete purchase orders.' });
        return;
      }

      await deletePurchaseOrder(id, warehouseId);
      res.json({ status: 'success', message: 'Purchase order deleted.' });
    } catch (err: any) {
      console.error('Error deleting purchase order:', err);
      res.status(500).json({ error: 'Failed to delete purchase order', details: err.message });
    }
  });

  // --- Personnel Dispatches Endpoints ---
  app.get('/api/dispatches', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      const dispatches = await getPersonnelDispatches(warehouseId);
      res.json({ dispatches });
    } catch (err: any) {
      console.error('Error retrieving dispatches:', err);
      res.status(500).json({ error: 'Failed to retrieve dispatch records', details: err.message });
    }
  });

  app.post('/api/dispatches', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role === 'viewer') {
        res.status(403).json({ error: 'Access denied: Viewers cannot record dispatches.' });
        return;
      }

      const dispatchData = req.body;
      if (!dispatchData.sku || !dispatchData.quantity || !dispatchData.recipientName) {
        res.status(400).json({ error: 'SKU, quantity, and recipient name are required.' });
        return;
      }

      const saved = await recordPersonnelDispatch({
        ...dispatchData,
        operator: req.user.name || 'System Operator'
      }, warehouseId);

      res.status(201).json({ status: 'success', dispatch: saved });
    } catch (err: any) {
      console.error('Error recording dispatch:', err);
      res.status(500).json({ error: 'Failed to record dispatch', details: err.message });
    }
  });

  // --- System Audit Logs Endpoints ---
  app.get('/api/audit-logs', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      const role = await getUserRoleInWarehouse(req.user.id, warehouseId);
      if (role !== 'admin' && role !== 'manager') {
        res.status(403).json({ error: 'Access denied: Only Administrators and Managers can view audit logs.' });
        return;
      }

      const limit = Number(req.query.limit || 100);
      const auditLogs = await getSystemAuditLogs(warehouseId, limit);
      res.json({ auditLogs });
    } catch (err: any) {
      console.error('Error fetching audit logs:', err);
      res.status(500).json({ error: 'Failed to retrieve system audit logs', details: err.message });
    }
  });

  app.post('/api/audit-logs', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      const { action, category, details, status } = req.body;
      if (!action || !category || !details) {
        res.status(400).json({ error: 'Action, category, and details are required for audit records.' });
        return;
      }

      await logSystemAudit({
        warehouseId,
        action,
        category,
        details,
        operator: req.user.name || 'System Operator',
        operatorId: req.user.id,
        status: status || 'SUCCESS'
      });

      res.json({ status: 'success' });
    } catch (err: any) {
      console.error('Error logging audit record:', err);
      res.status(500).json({ error: 'Failed to record audit log', details: err.message });
    }
  });

  // Get live zone capacity and occupancy metrics
  app.get('/api/zones/capacities', authenticateToken, async (req: any, res) => {
    try {
      const warehouseId = req.user.warehouseId;
      const capacities = await getZoneCapacity(warehouseId);
      res.json({ capacities });
    } catch (err: any) {
      console.error('Error calculating zone capacities:', err);
      res.status(500).json({ error: 'Failed to calculate zone capacities', details: err.message });
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
