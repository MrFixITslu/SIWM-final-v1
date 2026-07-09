import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
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
  resetDb 
} from './server-db.js';

async function startServer() {
  const app = express();
  
  // Configure the port: runs on PORT (3000) inside AI Studio, but defaults to 4000 in the user's container
  const PORT = parseInt(process.env.PORT || '4000', 10);

  // Middleware for parsing JSON requests
  app.use(express.json());

  // Initialize PostgreSQL database connection and migrations
  await initDb();

  // --- API Endpoints ---
  
  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
  });

  // Retrieve the entire warehouse dataset (items, transactions, suppliers, categories, zones)
  app.get('/api/data', async (req, res) => {
    try {
      const [items, transactions, suppliers, categories, zones] = await Promise.all([
        getItems(),
        getTransactions(),
        getSuppliers(),
        getCategories(),
        getZones()
      ]);
      res.json({ items, transactions, suppliers, categories, zones });
    } catch (err: any) {
      console.error('Error fetching data:', err);
      res.status(500).json({ error: 'Failed to fetch warehouse dataset from database', details: err.message });
    }
  });

  // Create a new inventory item
  app.post('/api/items', async (req, res) => {
    try {
      const item = req.body;
      if (!item.id || !item.name || !item.sku) {
        res.status(400).json({ error: 'Missing required item properties' });
        return;
      }

      await saveItem(item);

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
          operator: 'System Ingestion Operator'
        };
        await saveTransaction(newTx);
      }

      res.status(201).json({ status: 'success', item });
    } catch (err: any) {
      console.error('Error saving item:', err);
      res.status(500).json({ error: 'Failed to save item', details: err.message });
    }
  });

  // Update an existing inventory item
  app.put('/api/items/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const item = req.body;
      if (!item.name || !item.sku) {
        res.status(400).json({ error: 'Missing required item properties' });
        return;
      }

      await updateItem(id, item);
      res.json({ status: 'success', item });
    } catch (err: any) {
      console.error('Error updating item:', err);
      res.status(500).json({ error: 'Failed to update item', details: err.message });
    }
  });

  // Decommission/delete an item from active inventory tracking
  app.delete('/api/items/:id', async (req, res) => {
    try {
      const { id } = req.params;
      await deleteItem(id);
      res.json({ status: 'success', message: `Item ${id} deleted` });
    } catch (err: any) {
      console.error('Error deleting item:', err);
      res.status(500).json({ error: 'Failed to delete item', details: err.message });
    }
  });

  // Handle inbound intake or outbound dispatch adjustments
  app.post('/api/adjust', async (req, res) => {
    try {
      const { itemId, type, quantity, reason, operator } = req.body;
      if (!itemId || !type || !quantity) {
        res.status(400).json({ error: 'Missing adjustment parameters' });
        return;
      }

      // Fetch items to verify stock levels
      const itemsList = await getItems();
      const itemIndex = itemsList.findIndex((i: any) => i.id === itemId);
      if (itemIndex === -1) {
        res.status(404).json({ error: 'Item not found' });
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
        operator
      };

      // Save changes to database
      await updateItem(item.id, updatedItem);
      await saveTransaction(transaction);

      res.json({ status: 'success', item: updatedItem, transaction });
    } catch (err: any) {
      console.error('Error executing adjustment:', err);
      res.status(500).json({ error: 'Failed to execute transaction', details: err.message });
    }
  });

  // Handle restock purchase orders transmitted from procurement planner
  app.post('/api/restock', async (req, res) => {
    try {
      const { supplierId, itemsToRestock } = req.body;
      if (!supplierId || !itemsToRestock || !Array.isArray(itemsToRestock)) {
        res.status(400).json({ error: 'Missing purchase order fields' });
        return;
      }

      const [itemsList, suppliersList] = await Promise.all([getItems(), getSuppliers()]);
      const matchedSupplier = suppliersList.find((s: any) => s.id === supplierId);
      if (!matchedSupplier) {
        res.status(404).json({ error: 'Authorized supplier not found' });
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

        await updateItem(matchedItem.id, updatedItem);
        await saveTransaction(tx);

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
  app.post('/api/reset', async (req, res) => {
    try {
      await resetDb();
      res.json({ status: 'success', message: 'Database reset to default dataset completed successfully' });
    } catch (err: any) {
      console.error('Error resetting database:', err);
      res.status(500).json({ error: 'Failed to reset database', details: err.message });
    }
  });

  // --- Dev / Prod Static Asset Handlers ---

  if (process.env.NODE_ENV !== 'production') {
    // Integrate Vite as middleware in development
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    // Serve static compiled UI files in production
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
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
