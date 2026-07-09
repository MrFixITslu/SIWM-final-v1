import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Package, 
  Map, 
  History, 
  Users, 
  AlertTriangle, 
  Plus, 
  Search, 
  TrendingUp, 
  ArrowDownLeft, 
  ArrowUpRight, 
  Filter, 
  Trash2, 
  Edit3, 
  MapPin, 
  Clock, 
  Mail, 
  Phone, 
  Compass, 
  ChevronRight, 
  Check, 
  Download, 
  FileText,
  ShoppingBag,
  ExternalLink,
  RotateCcw
} from 'lucide-react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  Legend, 
  LineChart, 
  Line,
  CartesianGrid
} from 'recharts';
import confetti from 'canvas-confetti';

import { 
  InventoryItem, 
  Category, 
  WarehouseZone, 
  StockTransaction, 
  Supplier, 
  TransactionType,
  WarehouseLocation
} from './types';
import { 
  INITIAL_CATEGORIES, 
  INITIAL_SUPPLIERS, 
  INITIAL_ZONES, 
  INITIAL_ITEMS, 
  INITIAL_TRANSACTIONS 
} from './mockData';

export default function App() {
  // --- Persistent State ---
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [transactions, setTransactions] = useState<StockTransaction[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [zones, setZones] = useState<WarehouseZone[]>(INITIAL_ZONES);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/data');
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setTransactions(data.transactions || []);
        setSuppliers(data.suppliers || []);
        setCategories(data.categories || []);
        setZones(data.zones || INITIAL_ZONES);
      } else {
        showToast("Failed to connect to the central Postgres database layer.", "error");
      }
    } catch (err) {
      console.error("Database fetch error:", err);
      showToast("Central database connection error.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // --- UI Navigation ---
  const [activeTab, setActiveTab] = useState<'dashboard' | 'inventory' | 'map' | 'history' | 'suppliers'>('dashboard');

  // --- Search & Filter States ---
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedZone, setSelectedZone] = useState<string>('All');
  const [stockStatus, setStockStatus] = useState<'All' | 'In Stock' | 'Low Stock' | 'Out of Stock'>('All');
  const [sortField, setSortField] = useState<keyof InventoryItem | 'totalValue'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // --- Interactive Map State ---
  const [mapSelectedZone, setMapSelectedZone] = useState<string>('Zone-A');
  const [selectedMapCell, setSelectedMapCell] = useState<{ aisle: string; shelf: string } | null>(null);

  // --- Form Modal States ---
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [adjustingItem, setAdjustingItem] = useState<InventoryItem | null>(null);

  // --- Form Values States ---
  const [itemForm, setItemForm] = useState({
    name: '',
    sku: '',
    category: '',
    quantity: 0,
    unit: 'pcs',
    price: 0,
    zone: 'Zone-A',
    aisle: 'Aisle 01',
    shelf: 'Level 1',
    bin: 'Bin 01',
    supplierId: 'sup-1',
    minThreshold: 10,
    notes: ''
  });

  const [adjustForm, setAdjustForm] = useState({
    type: 'INBOUND' as TransactionType,
    quantity: 1,
    reason: 'Purchase Order Received',
    operator: 'Operator Station 01'
  });

  // --- Procurement Planner state ---
  const [procurementSuppliers, setProcurementSuppliers] = useState<Record<string, boolean>>({});

  // --- Help Toast/Banner ---
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // --- Reset All Data Helper ---
  const handleResetData = async () => {
    if (window.confirm("Are you sure you want to reset all data back to the default warehouse dataset? This will clear and reseed the central Postgres database.")) {
      setLoading(true);
      try {
        const res = await fetch('/api/reset', { method: 'POST' });
        if (res.ok) {
          await fetchData();
          showToast("Warehouse database has been restored to factory defaults", "info");
          confetti({ particleCount: 30, spread: 40 });
        } else {
          showToast("Failed to reset central database.", "error");
        }
      } catch (err) {
        showToast("Error resetting database.", "error");
      } finally {
        setLoading(false);
      }
    }
  };

  // --- Add / Edit Handlers ---
  const openAddModal = () => {
    setItemForm({
      name: '',
      sku: `SKU-${Math.floor(10000 + Math.random() * 90000)}`,
      category: categories[0]?.name || '',
      quantity: 0,
      unit: 'pcs',
      price: 0,
      zone: zones[0]?.id || 'Zone-A',
      aisle: 'Aisle 01',
      shelf: 'Level 1',
      bin: 'Bin 01',
      supplierId: suppliers[0]?.id || 'sup-1',
      minThreshold: 15,
      notes: ''
    });
    setIsAddModalOpen(true);
  };

  const openEditModal = (item: InventoryItem) => {
    setEditingItem(item);
    setItemForm({
      name: item.name,
      sku: item.sku,
      category: item.category,
      quantity: item.quantity,
      unit: item.unit,
      price: item.price,
      zone: item.warehouseLocation.zone,
      aisle: item.warehouseLocation.aisle,
      shelf: item.warehouseLocation.shelf,
      bin: item.warehouseLocation.bin,
      supplierId: item.supplierId,
      minThreshold: item.minThreshold,
      notes: item.notes || ''
    });
    setIsEditModalOpen(true);
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemForm.name || !itemForm.sku) {
      showToast("Please provide a valid product name and SKU", "error");
      return;
    }

    if (isAddModalOpen) {
      // Check SKU uniqueness
      if (items.some(i => i.sku.toLowerCase() === itemForm.sku.toLowerCase())) {
        showToast(`SKU ${itemForm.sku} already exists in warehouse directory!`, "error");
        return;
      }

      const newItem: InventoryItem = {
        id: `item-${Date.now()}`,
        name: itemForm.name,
        sku: itemForm.sku.toUpperCase(),
        category: itemForm.category,
        quantity: Number(itemForm.quantity),
        unit: itemForm.unit,
        price: Number(itemForm.price),
        warehouseLocation: {
          zone: itemForm.zone,
          aisle: itemForm.aisle,
          shelf: itemForm.shelf,
          bin: itemForm.bin
        },
        supplierId: itemForm.supplierId,
        minThreshold: Number(itemForm.minThreshold),
        lastUpdated: new Date().toISOString(),
        notes: itemForm.notes
      };

      setLoading(true);
      try {
        const res = await fetch('/api/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newItem)
        });
        if (res.ok) {
          await fetchData();
          setIsAddModalOpen(false);
          showToast(`Product "${newItem.name}" added to location ${newItem.warehouseLocation.zone} successfully!`);
          confetti({ particleCount: 50, spread: 60 });
        } else {
          showToast("Failed to save product to central database.", "error");
        }
      } catch (err) {
        showToast("Error communicating with central database.", "error");
      } finally {
        setLoading(false);
      }
    } else if (isEditModalOpen && editingItem) {
      const updatedItem = {
        name: itemForm.name,
        sku: itemForm.sku.toUpperCase(),
        category: itemForm.category,
        quantity: Number(itemForm.quantity),
        unit: itemForm.unit,
        price: Number(itemForm.price),
        warehouseLocation: {
          zone: itemForm.zone,
          aisle: itemForm.aisle,
          shelf: itemForm.shelf,
          bin: itemForm.bin
        },
        supplierId: itemForm.supplierId,
        minThreshold: Number(itemForm.minThreshold),
        lastUpdated: new Date().toISOString(),
        notes: itemForm.notes
      };

      setLoading(true);
      try {
        const res = await fetch(`/api/items/${editingItem.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedItem)
        });
        if (res.ok) {
          await fetchData();
          setIsEditModalOpen(false);
          setEditingItem(null);
          showToast(`Product "${itemForm.name}" updated successfully.`);
        } else {
          showToast("Failed to update product in database.", "error");
        }
      } catch (err) {
        showToast("Error updating product.", "error");
      } finally {
        setLoading(false);
      }
    }
  };

  const handleDeleteItem = async (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to decommission "${name}"? This deletes it from active stock tracking.`)) {
      setLoading(true);
      try {
        const res = await fetch(`/api/items/${id}`, { method: 'DELETE' });
        if (res.ok) {
          await fetchData();
          showToast(`Product "${name}" has been decommissioned.`, "info");
        } else {
          showToast("Failed to delete product from database.", "error");
        }
      } catch (err) {
        showToast("Error deleting product.", "error");
      } finally {
        setLoading(false);
      }
    }
  };

  // --- Quick Adjust Handlers ---
  const openAdjustModal = (item: InventoryItem, defaultType: TransactionType = 'INBOUND') => {
    setAdjustingItem(item);
    setAdjustForm({
      type: defaultType,
      quantity: 5,
      reason: defaultType === 'INBOUND' ? 'Purchase Order Received' : 'Customer Shipment Dispatch',
      operator: 'Floor Terminal B-12'
    });
    setIsAdjustModalOpen(true);
  };

  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingItem) return;

    const qty = Number(adjustForm.quantity);
    if (isNaN(qty) || qty <= 0) {
      showToast("Please enter a positive transaction quantity", "error");
      return;
    }

    if (adjustForm.type === 'OUTBOUND' && adjustingItem.quantity < qty) {
      showToast(`Insufficient stock! Active balance is ${adjustingItem.quantity} ${adjustingItem.unit}, requested dispatch is ${qty}.`, "error");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: adjustingItem.id,
          type: adjustForm.type,
          quantity: qty,
          reason: adjustForm.reason,
          operator: adjustForm.operator
        })
      });
      if (res.ok) {
        await fetchData();
        setIsAdjustModalOpen(false);
        setAdjustingItem(null);
        showToast(`Logged ${adjustForm.type} movement of ${qty} ${adjustingItem.unit} for ${adjustingItem.name}.`);
        if (adjustForm.type === 'INBOUND') {
          confetti({ particleCount: 15, spread: 30, origin: { y: 0.8 } });
        }
      } else {
        const data = await res.json();
        showToast(data.error || "Failed to log movement in database.", "error");
      }
    } catch (err) {
      showToast("Error connecting to database.", "error");
    } finally {
      setLoading(false);
    }
  };

  // --- Supplier Purchase Order restock action ---
  const handleTransmitRestock = async (supplierId: string, itemsToRestock: { id: string; qty: number }[]) => {
    if (itemsToRestock.length === 0) return;

    const supplier = suppliers.find(s => s.id === supplierId);
    if (!supplier) return;

    setLoading(true);
    try {
      const res = await fetch('/api/restock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplierId, itemsToRestock })
      });
      if (res.ok) {
        await fetchData();
        showToast(`Purchase order sent to ${supplier.name}. Restocked ${itemsToRestock.length} lines!`, "success");
        confetti({ particleCount: 70, spread: 80 });
      } else {
        showToast("Failed to transmit restock PO to database.", "error");
      }
    } catch (err) {
      showToast("Error restocking items.", "error");
    } finally {
      setLoading(false);
    }
  };

  // --- Export simulation ---
  const handleExportCSV = () => {
    const headers = ['ID', 'Name', 'SKU', 'Category', 'Quantity', 'Unit', 'Price ($)', 'Location', 'Supplier ID', 'Last Updated'];
    const rows = items.map(i => [
      i.id,
      `"${i.name}"`,
      i.sku,
      i.category,
      i.quantity,
      i.unit,
      i.price,
      `"${i.warehouseLocation.zone} - ${i.warehouseLocation.aisle} - ${i.warehouseLocation.shelf}"`,
      i.supplierId,
      i.lastUpdated
    ]);

    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `SIWM_Warehouse_Inventory_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("CSV inventory manifest downloaded successfully.");
  };

  // --- Calculations for Analytics ---
  const totalSkuCount = items.length;
  const totalStockQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalInventoryValue = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const lowStockItems = items.filter(item => item.quantity <= item.minThreshold);
  const lowStockCount = lowStockItems.length;

  // Occupancy rate calculation based on Zones
  const zoneAllocations = zones.map(z => {
    const zoneItems = items.filter(i => i.warehouseLocation.zone.toLowerCase().includes(z.id.toLowerCase()) || i.warehouseLocation.zone.toLowerCase().includes(z.name.toLowerCase()));
    const allocatedQty = zoneItems.reduce((sum, i) => sum + i.quantity, 0);
    const rate = Math.round((allocatedQty / z.maxCapacity) * 100);
    return {
      id: z.id,
      name: z.name,
      allocated: allocatedQty,
      capacity: z.maxCapacity,
      rate: Math.min(rate, 100)
    };
  });

  const totalCapacity = zones.reduce((sum, z) => sum + z.maxCapacity, 0);
  const totalAllocated = zoneAllocations.reduce((sum, z) => sum + z.allocated, 0);
  const overallOccupancyRate = Math.round((totalAllocated / totalCapacity) * 100);

  // Recharts Chart 1: Category breakdown (Stock Value)
  const categoryChartData = categories.map(cat => {
    const catItems = items.filter(i => i.category.toLowerCase() === cat.name.toLowerCase());
    const totalVal = catItems.reduce((sum, i) => sum + (i.price * i.quantity), 0);
    return {
      name: cat.name,
      value: Math.round(totalVal),
      color: cat.color
    };
  }).filter(c => c.value > 0);

  const COLOR_MAP: Record<string, string> = {
    indigo: '#6366f1',
    blue: '#3b82f6',
    emerald: '#10b981',
    amber: '#f59e0b',
    slate: '#64748b'
  };

  // Recharts Chart 2: Recent stock flow (Daily aggregates of Inbound vs Outbound volumes)
  const transactionChartData = (() => {
    // Collect the last 5 active days of transaction entries
    const days: Record<string, { date: string; inbound: number; outbound: number }> = {};
    const lastDays = [...transactions].reverse().slice(0, 15);
    
    lastDays.forEach(tx => {
      const dateStr = new Date(tx.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      if (!days[dateStr]) {
        days[dateStr] = { date: dateStr, inbound: 0, outbound: 0 };
      }
      if (tx.type === 'INBOUND') {
        days[dateStr].inbound += tx.quantity;
      } else {
        days[dateStr].outbound += tx.quantity;
      }
    });

    return Object.values(days).slice(-6);
  })();

  // --- Filtering & Sorting Logic for Directory ---
  const filteredItems = items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          item.sku.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
    const matchesZone = selectedZone === 'All' || item.warehouseLocation.zone.includes(selectedZone) || (selectedZone === 'Cold Storage' && item.warehouseLocation.zone.includes('Cold'));
    
    let matchesStatus = true;
    if (stockStatus === 'Low Stock') {
      matchesStatus = item.quantity <= item.minThreshold;
    } else if (stockStatus === 'In Stock') {
      matchesStatus = item.quantity > item.minThreshold;
    } else if (stockStatus === 'Out of Stock') {
      matchesStatus = item.quantity === 0;
    }

    return matchesSearch && matchesCategory && matchesZone && matchesStatus;
  });

  const sortedItems = [...filteredItems].sort((a, b) => {
    let aVal: any = sortField === 'totalValue' ? a.price * a.quantity : a[sortField as keyof InventoryItem];
    let bVal: any = sortField === 'totalValue' ? b.price * b.quantity : b[sortField as keyof InventoryItem];

    // Handle nested warehouse location mapping
    if (sortField === 'warehouseLocation') {
      aVal = `${a.warehouseLocation.zone} ${a.warehouseLocation.aisle}`;
      bVal = `${b.warehouseLocation.zone} ${b.warehouseLocation.aisle}`;
    }

    if (typeof aVal === 'string') {
      aVal = aVal.toLowerCase();
      bVal = bVal.toLowerCase();
    }

    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const toggleSort = (field: keyof InventoryItem | 'totalValue') => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // --- Interactive Shelf Cell Layout ---
  const mapAisles = ['Aisle 01', 'Aisle 02', 'Aisle 03', 'Aisle 04'];
  const mapShelves = ['Level 3', 'Level 2', 'Level 1']; // Top down representation

  // Find item stored at map cell coordinates
  const getItemAtLocation = (zone: string, aisle: string, shelf: string) => {
    return items.find(i => 
      (i.warehouseLocation.zone.includes(zone) || zone.includes(i.warehouseLocation.zone)) &&
      i.warehouseLocation.aisle === aisle &&
      i.warehouseLocation.shelf === shelf
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-slate-100 font-sans antialiased" id="siwm_root_app">
      
      {/* Toast Notification Container */}
      {toastMessage && (
        <div id="siwm_toast" className="fixed bottom-6 right-6 z-50 animate-bounce flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-2xl bg-slate-800 border-l-4 border-emerald-500 text-white min-w-80">
          <div className="p-1 rounded-full bg-emerald-500/20 text-emerald-400">
            {toastMessage.type === 'error' ? <AlertTriangle className="h-5 w-5 text-rose-400" /> : <Check className="h-5 w-5" />}
          </div>
          <div>
            <p className="text-sm font-medium">{toastMessage.text}</p>
          </div>
        </div>
      )}

      {/* Primary Navigation Shell */}
      <div className="flex flex-1" id="siwm_main_layout">
        
        {/* SIDEBAR NAVIGATION RAIL */}
        <aside id="siwm_sidebar" className="w-72 bg-slate-950 border-r border-slate-800 flex flex-col justify-between shrink-0">
          <div>
            {/* Branding Header */}
            <div className="p-6 border-b border-slate-800 flex items-center gap-3.5" id="siwm_brand">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-lg shadow-indigo-500/20">
                <Package className="h-6 w-6 animate-pulse" />
              </div>
              <div>
                <h1 className="text-base font-bold tracking-tight text-white leading-tight">SIWM Systems</h1>
                <span className="text-xs text-indigo-400 font-medium tracking-widest uppercase">Smart Warehouse</span>
              </div>
            </div>

            {/* Operator/Environment Quick Stats */}
            <div className="p-4 mx-4 my-3 rounded-xl bg-slate-900/60 border border-slate-800/80" id="siwm_operator_badge">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Clock className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                <span className="truncate font-mono">2026-07-09 14:58:30 UTC</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-400">
                <Users className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                <span className="truncate font-medium">{`Vision79SLU@gmail.com`}</span>
              </div>
            </div>

            {/* Navigation Options */}
            <nav className="px-3 py-4 space-y-1.5" id="siwm_nav_list">
              <button 
                id="btn_nav_dashboard"
                onClick={() => setActiveTab('dashboard')}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 group ${
                  activeTab === 'dashboard' 
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/10' 
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'
                }`}
              >
                <div className="flex items-center gap-3">
                  <LayoutDashboard className={`h-4.5 w-4.5 ${activeTab === 'dashboard' ? 'text-white' : 'text-slate-400 group-hover:text-indigo-400'}`} />
                  <span>Dashboard Overview</span>
                </div>
                <ChevronRight className="h-4 w-4 opacity-40 group-hover:opacity-100 transition-opacity" />
              </button>

              <button 
                id="btn_nav_inventory"
                onClick={() => setActiveTab('inventory')}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 group ${
                  activeTab === 'inventory' 
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/10' 
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Package className={`h-4.5 w-4.5 ${activeTab === 'inventory' ? 'text-white' : 'text-slate-400 group-hover:text-indigo-400'}`} />
                  <span>Stock Directory</span>
                </div>
                {lowStockCount > 0 && (
                  <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] px-2 py-0.5 rounded-full font-bold">
                    {lowStockCount} ALERT
                  </span>
                )}
              </button>

              <button 
                id="btn_nav_map"
                onClick={() => setActiveTab('map')}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 group ${
                  activeTab === 'map' 
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/10' 
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Map className={`h-4.5 w-4.5 ${activeTab === 'map' ? 'text-white' : 'text-slate-400 group-hover:text-indigo-400'}`} />
                  <span>Warehouse Layout Map</span>
                </div>
                <ChevronRight className="h-4 w-4 opacity-40 group-hover:opacity-100 transition-opacity" />
              </button>

              <button 
                id="btn_nav_history"
                onClick={() => setActiveTab('history')}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 group ${
                  activeTab === 'history' 
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/10' 
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'
                }`}
              >
                <div className="flex items-center gap-3">
                  <History className={`h-4.5 w-4.5 ${activeTab === 'history' ? 'text-white' : 'text-slate-400 group-hover:text-indigo-400'}`} />
                  <span>Stock Adjustment Logs</span>
                </div>
                <ChevronRight className="h-4 w-4 opacity-40 group-hover:opacity-100 transition-opacity" />
              </button>

              <button 
                id="btn_nav_suppliers"
                onClick={() => setActiveTab('suppliers')}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 group ${
                  activeTab === 'suppliers' 
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/10' 
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Users className={`h-4.5 w-4.5 ${activeTab === 'suppliers' ? 'text-white' : 'text-slate-400 group-hover:text-indigo-400'}`} />
                  <span>Suppliers & Procurement</span>
                </div>
                <ChevronRight className="h-4 w-4 opacity-40 group-hover:opacity-100 transition-opacity" />
              </button>
            </nav>
          </div>

          {/* Sidebar Footer System Status */}
          <div className="p-4 border-t border-slate-800" id="siwm_sidebar_footer">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-3">
              <span>Database Instance: {loading ? 'SYNCING...' : 'POSTGRESQL'}</span>
              <span className="flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${loading ? 'bg-amber-500' : 'bg-emerald-500'} animate-ping`}></span>
                <span className={`${loading ? 'text-amber-400' : 'text-emerald-400'} font-semibold uppercase`}>{loading ? 'SYNCING' : 'ONLINE'}</span>
              </span>
            </div>
            <button 
              id="btn_restore_data"
              onClick={handleResetData}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-800 transition text-slate-400 hover:text-slate-200"
            >
              <RotateCcw className="h-3 w-3" />
              Reset Warehouse Data
            </button>
          </div>
        </aside>

        {/* WORKSPACE AREA CONTAINER */}
        <main id="siwm_workspace" className="flex-1 flex flex-col min-w-0 bg-slate-950 overflow-y-auto">
          
          {/* TOP BAR BRAND BANNER / CONTROLS */}
          <header id="siwm_header" className="px-8 py-5 border-b border-slate-800/80 flex items-center justify-between bg-slate-950/40">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-3">
                {activeTab === 'dashboard' && '📊 Warehouse Analytics Dashboard'}
                {activeTab === 'inventory' && '📦 Stock Directory & Inventory Control'}
                {activeTab === 'map' && '🗺️ Location mapping & Bay Allocation'}
                {activeTab === 'history' && '🔄 Stock Adjustment Audit Logs'}
                {activeTab === 'suppliers' && '🤝 Suppliers Contact Book & Reorder Planner'}
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                {activeTab === 'dashboard' && 'Real-time telemetry, stock valuations, low stock alerts, and zone utilization ratios.'}
                {activeTab === 'inventory' && 'Browse, search, edit, and quickly log inbound shipments or outbound customer orders.'}
                {activeTab === 'map' && 'Interactive rack layout of specific aisles, shelves and bin allocations. Occupancy heatmap.'}
                {activeTab === 'history' && 'Comprehensive historical audit logs of item receipts, shipments, safety dispenses, and disposals.'}
                {activeTab === 'suppliers' && 'Group low stock elements by suppliers and automatically transmit mock purchase order requests.'}
              </p>
            </div>

            <div className="flex items-center gap-3" id="siwm_header_actions">
              {activeTab === 'inventory' && (
                <>
                  <button 
                    id="btn_export_manifest"
                    onClick={handleExportCSV}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl text-sm font-semibold border border-slate-800 transition"
                  >
                    <Download className="h-4 w-4" />
                    Export CSV Manifest
                  </button>
                  <button 
                    id="btn_add_item"
                    onClick={openAddModal}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-indigo-600/20 transition"
                  >
                    <Plus className="h-4.5 w-4.5" />
                    Record New SKU
                  </button>
                </>
              )}
              {activeTab === 'history' && (
                <button 
                  id="btn_export_history_logs"
                  onClick={handleExportCSV} // Mock CSV download is also items list, or we can format transactions!
                  className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl text-sm font-semibold border border-slate-800 transition"
                >
                  <Download className="h-4 w-4" />
                  Export Audit Trail
                </button>
              )}
            </div>
          </header>

          {/* VIEW RENDER CONTROLLERS */}
          <div className="p-8 flex-1" id="siwm_view_container">
            
            {/* 1. DASHBOARD VIEW PANEL */}
            {activeTab === 'dashboard' && (
              <div className="space-y-8 animate-fade-in" id="panel_dashboard">
                
                {/* TELEMETRY STATS CARDS GRID */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" id="dashboard_stats_grid">
                  
                  {/* Card 1: Unique SKUs */}
                  <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-2xl flex items-center justify-between" id="card_unique_skus">
                    <div>
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Active SKUs</span>
                      <h3 className="text-3xl font-extrabold text-white mt-1.5">{totalSkuCount}</h3>
                      <div className="flex items-center gap-1.5 text-xs text-emerald-400 mt-2 font-medium">
                        <TrendingUp className="h-3.5 w-3.5" />
                        <span>Optimal inventory diversity</span>
                      </div>
                    </div>
                    <div className="p-4 bg-indigo-500/10 text-indigo-400 rounded-2xl border border-indigo-500/15">
                      <Package className="h-7 w-7" />
                    </div>
                  </div>

                  {/* Card 2: Valuation */}
                  <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-2xl flex items-center justify-between" id="card_stock_value">
                    <div>
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Asset Valuation</span>
                      <h3 className="text-3xl font-extrabold text-white mt-1.5">
                        ${totalInventoryValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </h3>
                      <span className="text-xs text-slate-400 block mt-2 font-medium">
                        Across {totalStockQuantity.toLocaleString()} physical units
                      </span>
                    </div>
                    <div className="p-4 bg-emerald-500/10 text-emerald-400 rounded-2xl border border-emerald-500/15">
                      <TrendingUp className="h-7 w-7" />
                    </div>
                  </div>

                  {/* Card 3: Stock alerts */}
                  <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-2xl flex items-center justify-between" id="card_stock_alerts">
                    <div>
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Low Stock Alerts</span>
                      <h3 className={`text-3xl font-extrabold mt-1.5 ${lowStockCount > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                        {lowStockCount}
                      </h3>
                      <div className="flex items-center gap-1.5 text-xs mt-2 font-semibold">
                        {lowStockCount > 0 ? (
                          <span className="text-amber-400 flex items-center gap-1">
                            <AlertTriangle className="h-3.5 w-3.5 animate-bounce text-amber-500" />
                            Requires replenishment
                          </span>
                        ) : (
                          <span className="text-emerald-400">All levels secure</span>
                        )}
                      </div>
                    </div>
                    <div className={`p-4 rounded-2xl border ${
                      lowStockCount > 0 
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/15' 
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}>
                      <AlertTriangle className="h-7 w-7" />
                    </div>
                  </div>

                  {/* Card 4: Occupancy Rate */}
                  <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-2xl flex items-center justify-between" id="card_occupancy">
                    <div>
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Zone Occupancy</span>
                      <h3 className="text-3xl font-extrabold text-white mt-1.5">{overallOccupancyRate}%</h3>
                      <div className="w-28 mt-3 bg-slate-800 rounded-full h-1.5">
                        <div 
                          className={`h-1.5 rounded-full ${
                            overallOccupancyRate > 85 ? 'bg-rose-500' : overallOccupancyRate > 60 ? 'bg-indigo-500' : 'bg-emerald-500'
                          }`} 
                          style={{ width: `${Math.min(overallOccupancyRate, 100)}%` }}
                        ></div>
                      </div>
                    </div>
                    <div className="p-4 bg-blue-500/10 text-blue-400 rounded-2xl border border-blue-500/15">
                      <Compass className="h-7 w-7" />
                    </div>
                  </div>
                </div>

                {/* VISUAL CHARTS GRID CONTAINER */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8" id="dashboard_charts_grid">
                  
                  {/* Chart A: Stock Movements History Line (Left 7 Columns) */}
                  <div className="lg:col-span-7 bg-slate-900/60 border border-slate-800/80 p-6 rounded-2xl flex flex-col justify-between" id="chart_stock_movements">
                    <div>
                      <h3 className="text-base font-bold text-white mb-1">Stock Flow Telemetry</h3>
                      <p className="text-xs text-slate-400 mb-6">Aggregate transactions showcasing inbound intake vs outbound customer dispatch volume.</p>
                    </div>
                    <div className="h-72 w-full">
                      {transactionChartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={transactionChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
                            <YAxis stroke="#94a3b8" fontSize={11} />
                            <Tooltip 
                              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc', borderRadius: '12px' }} 
                            />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Bar dataKey="inbound" name="Inbound Received" fill="#10b981" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="outbound" name="Outbound Dispatched" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm">
                          <History className="h-8 w-8 mb-2 opacity-50" />
                          No recent movements to plot. Use Stock Directory to receive/ship.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Chart B: Category Breakdown Pie (Right 5 Columns) */}
                  <div className="lg:col-span-5 bg-slate-900/60 border border-slate-800/80 p-6 rounded-2xl flex flex-col justify-between" id="chart_category_breakdown">
                    <div>
                      <h3 className="text-base font-bold text-white mb-1">Asset Allocation by Category</h3>
                      <p className="text-xs text-slate-400 mb-6">Visual percentage breakdown of active stock capital value ($) across zones.</p>
                    </div>
                    <div className="h-56 w-full relative flex items-center justify-center">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={categoryChartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={4}
                            dataKey="value"
                          >
                            {categoryChartData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLOR_MAP[entry.color] || '#6366f1'} />
                            ))}
                          </Pie>
                          <Tooltip 
                            formatter={(value: any) => [`$${value.toLocaleString()}`, 'Total Valuation']}
                            contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc', borderRadius: '12px' }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      {/* Center summary text */}
                      <div className="absolute flex flex-col items-center justify-center">
                        <span className="text-xs text-slate-400 uppercase tracking-widest font-semibold">Total Assets</span>
                        <span className="text-lg font-bold text-white">${Math.round(totalInventoryValue / 1000)}k</span>
                      </div>
                    </div>
                    {/* Custom legend */}
                    <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
                      {categoryChartData.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 text-slate-300">
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: COLOR_MAP[c.color] || '#6366f1' }}></span>
                          <span className="truncate font-medium">{c.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* BOTTOM REGION: CRITICAL ALERTS & ZONE OCCUPANCY GRIDS */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8" id="dashboard_detail_region">
                  
                  {/* Dynamic Alert Panel - Low Stock Item Actions */}
                  <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-2xl" id="dashboard_alerts_panel">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-amber-400" />
                        <h3 className="text-base font-bold text-white">Active Low Stock Triggers ({lowStockCount})</h3>
                      </div>
                      <button 
                        id="btn_view_planner"
                        onClick={() => setActiveTab('suppliers')}
                        className="text-indigo-400 hover:text-indigo-300 text-xs font-semibold flex items-center gap-1 hover:underline"
                      >
                        Procure Replenishments
                        <ChevronRight className="h-3 w-3" />
                      </button>
                    </div>

                    {lowStockCount === 0 ? (
                      <div className="bg-slate-950/40 border border-slate-850 p-8 rounded-xl text-center text-slate-400 text-sm">
                        <Check className="h-8 w-8 text-emerald-400 mx-auto mb-2.5 bg-emerald-500/10 p-1.5 rounded-full" />
                        All product lines have optimal stock volumes. Secure parameters!
                      </div>
                    ) : (
                      <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                        {lowStockItems.map(item => (
                          <div key={item.id} className="p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/15 flex items-center justify-between hover:bg-amber-500/10 transition-colors">
                            <div className="min-w-0 flex-1 pr-4">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-mono font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">
                                  {item.sku}
                                </span>
                                <h4 className="text-sm font-bold text-white truncate">{item.name}</h4>
                              </div>
                              <p className="text-xs text-slate-400 mt-1">
                                Stock Balance: <span className="text-rose-400 font-extrabold">{item.quantity} {item.unit}</span> (Min Threshold: {item.minThreshold}) • Zone: {item.warehouseLocation.zone}
                              </p>
                            </div>
                            <button 
                              id={`btn_quick_replenish_${item.id}`}
                              onClick={() => openAdjustModal(item, 'INBOUND')}
                              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg transition shrink-0"
                            >
                              Receive Stock
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Physical Zone Heatmap Capacity Chart */}
                  <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-2xl" id="dashboard_zone_occupancy">
                    <h3 className="text-base font-bold text-white mb-1">Physical Zone Utilisation</h3>
                    <p className="text-xs text-slate-400 mb-6">Individual storage limits allocated per physical warehouse bay segment.</p>
                    
                    <div className="space-y-4">
                      {zoneAllocations.map(zone => (
                        <div key={zone.id} className="p-3.5 rounded-xl bg-slate-950/40 border border-slate-850">
                          <div className="flex items-center justify-between text-xs font-semibold mb-2">
                            <div className="flex items-center gap-2 text-slate-200">
                              <MapPin className="h-3.5 w-3.5 text-indigo-400" />
                              <span>{zone.name}</span>
                            </div>
                            <span className="text-slate-400 font-mono">
                              {zone.allocated.toLocaleString()} / {zone.capacity.toLocaleString()} units ({zone.rate}%)
                            </span>
                          </div>
                          
                          {/* Progress slider bar */}
                          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                            <div 
                              className={`h-2 rounded-full transition-all duration-500 ${
                                zone.rate > 90 
                                  ? 'bg-rose-500' 
                                  : zone.rate > 65 
                                    ? 'bg-amber-500' 
                                    : 'bg-emerald-500'
                              }`}
                              style={{ width: `${zone.rate}%` }}
                            ></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>

              </div>
            )}

            {/* 2. INVENTORY LIST VIEW PANEL */}
            {activeTab === 'inventory' && (
              <div className="space-y-6 animate-fade-in" id="panel_inventory">
                
                {/* SEARCH AND INTEGRATED CONTROLS PANEL */}
                <div className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-2xl flex flex-col md:flex-row items-stretch md:items-center gap-4" id="inventory_controls">
                  
                  {/* Search Bar Input */}
                  <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-400" />
                    <input 
                      id="input_search_items"
                      type="text" 
                      placeholder="Search active inventory by product name or SKU..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800/80 rounded-xl py-3 pl-11 pr-4 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition"
                    />
                  </div>

                  {/* Filter elements */}
                  <div className="flex flex-wrap items-center gap-3">
                    
                    {/* Category Filter */}
                    <div className="flex items-center gap-2">
                      <Filter className="h-4 w-4 text-slate-400" />
                      <select 
                        id="select_filter_category"
                        value={selectedCategory} 
                        onChange={(e) => setSelectedCategory(e.target.value)}
                        className="bg-slate-950 border border-slate-800/80 rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="All">All Categories</option>
                        {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>

                    {/* Zone Location Filter */}
                    <select 
                      id="select_filter_zone"
                      value={selectedZone} 
                      onChange={(e) => setSelectedZone(e.target.value)}
                      className="bg-slate-950 border border-slate-800/80 rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="All">All Warehouse Zones</option>
                      {zones.map(z => <option key={z.id} value={z.name}>{z.name}</option>)}
                    </select>

                    {/* Stock Alert Filter Status */}
                    <select 
                      id="select_filter_stock_status"
                      value={stockStatus} 
                      onChange={(e) => setStockStatus(e.target.value as any)}
                      className="bg-slate-950 border border-slate-800/80 rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="All">All Stock Levels</option>
                      <option value="In Stock">In Stock (Normal)</option>
                      <option value="Low Stock">Low Stock Alert</option>
                      <option value="Out of Stock">Out of Stock (Zero)</option>
                    </select>

                    {/* Clear filter button */}
                    {(searchTerm || selectedCategory !== 'All' || selectedZone !== 'All' || stockStatus !== 'All') && (
                      <button 
                        id="btn_clear_filters"
                        onClick={() => {
                          setSearchTerm('');
                          setSelectedCategory('All');
                          setSelectedZone('All');
                          setStockStatus('All');
                        }}
                        className="p-2 text-xs font-bold text-rose-400 hover:text-rose-300 transition"
                      >
                        Clear Filters
                      </button>
                    )}

                  </div>

                </div>

                {/* MAIN SPREADSHEET TABLE GRID */}
                <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl overflow-hidden shadow-xl" id="inventory_table_panel">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse" id="tbl_inventory">
                      <thead>
                        <tr className="bg-slate-950/80 border-b border-slate-800/80 text-xs font-bold text-slate-400 uppercase tracking-widest">
                          <th className="py-4.5 px-6 select-none cursor-pointer hover:text-indigo-400" onClick={() => toggleSort('sku')}>
                            SKU {sortField === 'sku' && (sortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th className="py-4.5 px-6 select-none cursor-pointer hover:text-indigo-400" onClick={() => toggleSort('name')}>
                            Product Designation {sortField === 'name' && (sortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th className="py-4.5 px-6 select-none cursor-pointer hover:text-indigo-400" onClick={() => toggleSort('category')}>
                            Category {sortField === 'category' && (sortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th className="py-4.5 px-6 select-none cursor-pointer hover:text-indigo-400 text-right" onClick={() => toggleSort('quantity')}>
                            Quantity {sortField === 'quantity' && (sortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th className="py-4.5 px-6 select-none cursor-pointer hover:text-indigo-400 text-right" onClick={() => toggleSort('price')}>
                            Unit Cost {sortField === 'price' && (sortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th className="py-4.5 px-6 select-none cursor-pointer hover:text-indigo-400 text-right" onClick={() => toggleSort('totalValue')}>
                            Total Val {sortField === 'totalValue' && (sortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th className="py-4.5 px-6 select-none cursor-pointer hover:text-indigo-400" onClick={() => toggleSort('warehouseLocation')}>
                            Storage Slot {sortField === 'warehouseLocation' && (sortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th className="py-4.5 px-6 text-center">Inbound/Outbound Actions</th>
                          <th className="py-4.5 px-6 text-right">Edit/Del</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50 text-sm">
                        {sortedItems.length === 0 ? (
                          <tr id="row_empty_search">
                            <td colSpan={9} className="py-12 text-center text-slate-500">
                              <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
                              No items in active warehouse inventory match these filter criteria.
                            </td>
                          </tr>
                        ) : (
                          sortedItems.map(item => {
                            const isLowStock = item.quantity <= item.minThreshold;
                            const isOutOfStock = item.quantity === 0;
                            const supplier = suppliers.find(s => s.id === item.supplierId);
                            
                            return (
                              <tr key={item.id} className="hover:bg-slate-900/30 transition-colors group" id={`row_item_${item.id}`}>
                                {/* SKU */}
                                <td className="py-4 px-6 font-mono font-bold text-xs">
                                  <span className="px-2 py-1 bg-slate-950 text-indigo-400 border border-slate-800 rounded">
                                    {item.sku}
                                  </span>
                                </td>
                                
                                {/* Product Designation */}
                                <td className="py-4 px-6">
                                  <div>
                                    <span className="font-bold text-white text-base leading-tight block">{item.name}</span>
                                    {item.notes && <span className="text-xs text-slate-400 mt-1 line-clamp-1 italic">{item.notes}</span>}
                                  </div>
                                </td>

                                {/* Category */}
                                <td className="py-4 px-6">
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-bold tracking-wider uppercase bg-indigo-500/10 text-indigo-400 border border-indigo-500/15">
                                    {item.category}
                                  </span>
                                </td>

                                {/* Quantity */}
                                <td className="py-4 px-6 text-right font-bold">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <span className={
                                      isOutOfStock 
                                        ? 'text-rose-500 font-extrabold line-through' 
                                        : isLowStock 
                                          ? 'text-amber-400 font-extrabold animate-pulse' 
                                          : 'text-slate-200'
                                    }>
                                      {item.quantity}
                                    </span>
                                    <span className="text-xs text-slate-400 font-normal">{item.unit}</span>
                                  </div>
                                  {isLowStock && (
                                    <span className="text-[10px] font-extrabold tracking-wider text-amber-500 uppercase bg-amber-500/10 px-1.5 py-0.5 rounded ml-1">
                                      {isOutOfStock ? 'OUT OF STOCK' : 'LOW STOCK'}
                                    </span>
                                  )}
                                </td>

                                {/* Unit Cost */}
                                <td className="py-4 px-6 text-right text-slate-200 font-mono">
                                  ${item.price.toFixed(2)}
                                </td>

                                {/* Total Val */}
                                <td className="py-4 px-6 text-right text-slate-100 font-bold font-mono">
                                  ${(item.price * item.quantity).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>

                                {/* Storage Location Slot */}
                                <td className="py-4 px-6">
                                  <div className="flex items-center gap-1.5 text-xs text-slate-300 font-medium">
                                    <MapPin className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                                    <span>
                                      {item.warehouseLocation.zone.replace('Warehouse Zone', '').replace('Storage', '')} • {item.warehouseLocation.aisle} • {item.warehouseLocation.shelf}
                                    </span>
                                  </div>
                                </td>

                                {/* Inbound/Outbound quick buttons */}
                                <td className="py-4 px-6">
                                  <div className="flex items-center justify-center gap-2">
                                    <button 
                                      id={`btn_quick_inbound_${item.id}`}
                                      onClick={() => openAdjustModal(item, 'INBOUND')}
                                      className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:text-white border border-emerald-500/15 transition flex items-center gap-1 text-xs font-bold"
                                      title="Receive stock (Inbound flow)"
                                    >
                                      <ArrowDownLeft className="h-3.5 w-3.5" />
                                      Inbound
                                    </button>
                                    <button 
                                      id={`btn_quick_outbound_${item.id}`}
                                      onClick={() => openAdjustModal(item, 'OUTBOUND')}
                                      disabled={item.quantity === 0}
                                      className={`p-1.5 rounded-lg border transition flex items-center gap-1 text-xs font-bold ${
                                        item.quantity === 0
                                          ? 'opacity-40 cursor-not-allowed bg-slate-900 text-slate-600 border-slate-800'
                                          : 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 hover:text-white border-amber-500/15'
                                      }`}
                                      title="Ship stock (Outbound flow)"
                                    >
                                      <ArrowUpRight className="h-3.5 w-3.5" />
                                      Outbound
                                    </button>
                                  </div>
                                </td>

                                {/* Actions */}
                                <td className="py-4 px-6 text-right">
                                  <div className="flex items-center justify-end gap-2.5 opacity-60 group-hover:opacity-100 transition-opacity">
                                    <button 
                                      id={`btn_edit_${item.id}`}
                                      onClick={() => openEditModal(item)}
                                      className="p-1.5 rounded bg-slate-950 text-slate-400 hover:text-white hover:bg-indigo-600 transition"
                                      title="Modify record specs"
                                    >
                                      <Edit3 className="h-4.5 w-4.5" />
                                    </button>
                                    <button 
                                      id={`btn_delete_${item.id}`}
                                      onClick={() => handleDeleteItem(item.id, item.name)}
                                      className="p-1.5 rounded bg-slate-950 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition"
                                      title="Decommission item"
                                    >
                                      <Trash2 className="h-4.5 w-4.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            )}

            {/* 3. WAREHOUSE MAP BAY RACKING VIEW */}
            {activeTab === 'map' && (
              <div className="space-y-6 animate-fade-in" id="panel_map">
                
                {/* ZONE SELECTOR CONTROLLER BAR */}
                <div className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-2xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4" id="map_controls">
                  <div className="flex items-center gap-3">
                    <Compass className="h-5 w-5 text-indigo-400" />
                    <div>
                      <h3 className="text-base font-bold text-white">Interactive Racking Layout Grid</h3>
                      <p className="text-xs text-slate-400">Map grid displaying exact rack slots. Hover cell to view stored SKU metrics.</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 font-semibold">Active Mapping Zone:</span>
                    <select 
                      id="select_map_active_zone"
                      value={mapSelectedZone}
                      onChange={(e) => {
                        setMapSelectedZone(e.target.value);
                        setSelectedMapCell(null);
                      }}
                      className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs font-bold text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8" id="map_layout_region">
                  
                  {/* MAIN RACKING GRID DISPLAY (8 COLUMNS) */}
                  <div className="lg:col-span-8 bg-slate-900/60 border border-slate-800/80 p-6 rounded-2xl flex flex-col" id="map_grid_board">
                    <div className="flex items-center justify-between mb-6">
                      <h4 className="text-sm font-bold text-slate-300">
                        Bay Elevation Grid: <span className="text-white">{zones.find(z => z.id === mapSelectedZone)?.name}</span>
                      </h4>
                      <div className="flex items-center gap-4 text-xs font-medium text-slate-400">
                        <span className="flex items-center gap-1.5">
                          <span className="h-3 w-3 rounded bg-emerald-500/20 border border-emerald-500/30"></span>
                          Normal Balance
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="h-3 w-3 rounded bg-amber-500/20 border border-amber-500/30"></span>
                          Low Stock / Alarm
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="h-3 w-3 rounded bg-slate-950 border border-slate-800"></span>
                          Empty Bay Slot
                        </span>
                      </div>
                    </div>

                    {/* PHYSICAL GRID */}
                    <div className="grid grid-cols-4 gap-4 flex-1" id="grid_bays">
                      {mapAisles.map(aisle => (
                        <div key={aisle} className="space-y-4" id={`aisle_column_${aisle.replace(' ', '')}`}>
                          <div className="text-center py-1.5 bg-slate-950 border border-slate-850 rounded-lg text-xs font-bold text-indigo-400">
                            {aisle}
                          </div>
                          
                          <div className="space-y-3">
                            {mapShelves.map(shelf => {
                              const item = getItemAtLocation(mapSelectedZone, aisle, shelf);
                              const isSelected = selectedMapCell?.aisle === aisle && selectedMapCell?.shelf === shelf;
                              
                              let bgStyle = "bg-slate-950/40 border-slate-850 text-slate-600 hover:border-slate-700";
                              if (item) {
                                const isLow = item.quantity <= item.minThreshold;
                                bgStyle = isLow 
                                  ? "bg-amber-500/5 border-amber-500/20 hover:border-amber-500/40 text-amber-300 shadow-md shadow-amber-500/5" 
                                  : "bg-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40 text-emerald-300 shadow-md shadow-emerald-500/5";
                              }

                              return (
                                <div 
                                  key={shelf}
                                  id={`map_cell_${aisle.replace(' ', '')}_${shelf.replace(' ', '')}`}
                                  onClick={() => setSelectedMapCell({ aisle, shelf })}
                                  className={`p-4 rounded-xl border text-center transition-all duration-200 cursor-pointer flex flex-col justify-between h-28 relative overflow-hidden group ${bgStyle} ${
                                    isSelected ? 'ring-2 ring-indigo-500 scale-102 border-indigo-500/60 z-10' : ''
                                  }`}
                                >
                                  <span className="text-[10px] text-slate-500 block font-semibold text-left uppercase">
                                    {shelf}
                                  </span>

                                  {item ? (
                                    <div className="text-left mt-1.5">
                                      <span className="text-xs font-extrabold text-white line-clamp-1 block leading-tight">
                                        {item.name}
                                      </span>
                                      <div className="flex items-center justify-between text-[11px] mt-2 font-mono font-medium">
                                        <span className="text-slate-400">{item.sku}</span>
                                        <span className={item.quantity <= item.minThreshold ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>
                                          {item.quantity} {item.unit}
                                        </span>
                                      </div>
                                    </div>
                                  ) : (
                                    <span className="text-xs font-medium text-slate-600 italic my-auto block">
                                      Unassigned
                                    </span>
                                  )}

                                  {/* Quick tooltip indicator details */}
                                  <div className="absolute right-2 top-2 p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 inline-block"></span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* SIDE CELL STATS DETAIL INSPECTOR (4 COLUMNS) */}
                  <div className="lg:col-span-4" id="map_detail_sidebar">
                    {selectedMapCell ? (() => {
                      const item = getItemAtLocation(mapSelectedZone, selectedMapCell.aisle, selectedMapCell.shelf);
                      const supplier = item ? suppliers.find(s => s.id === item.supplierId) : null;
                      
                      return (
                        <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-2xl h-full flex flex-col justify-between animate-fade-in" id="map_cell_inspector">
                          <div>
                            <div className="flex items-center justify-between border-b border-slate-800/80 pb-4 mb-5">
                              <h3 className="text-sm font-bold text-slate-300">Slot Audit Inspector</h3>
                              <span className="text-xs font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded">
                                {selectedMapCell.aisle} • {selectedMapCell.shelf}
                              </span>
                            </div>

                            {item ? (
                              <div className="space-y-5" id="inspector_item_details">
                                <div>
                                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Product Identifier</span>
                                  <h4 className="text-lg font-bold text-white mt-1 leading-snug">{item.name}</h4>
                                  <span className="inline-block mt-2 px-2 py-0.5 text-xs font-mono font-bold bg-slate-950 text-indigo-400 border border-slate-800 rounded">
                                    {item.sku}
                                  </span>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                  <div className="p-3 bg-slate-950/60 border border-slate-850 rounded-xl">
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Quantity In Bay</span>
                                    <span className={`text-base font-bold mt-1 block ${item.quantity <= item.minThreshold ? 'text-amber-400' : 'text-emerald-400'}`}>
                                      {item.quantity} {item.unit}
                                    </span>
                                  </div>
                                  <div className="p-3 bg-slate-950/60 border border-slate-850 rounded-xl">
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Est. Value</span>
                                    <span className="text-base font-bold mt-1 text-white block font-mono">
                                      ${(item.price * item.quantity).toLocaleString('en', { maximumFractionDigits: 0 })}
                                    </span>
                                  </div>
                                </div>

                                <div className="space-y-2 text-xs">
                                  <div className="flex justify-between py-1.5 border-b border-slate-800/50">
                                    <span className="text-slate-400">Product Category</span>
                                    <span className="text-white font-semibold">{item.category}</span>
                                  </div>
                                  <div className="flex justify-between py-1.5 border-b border-slate-800/50">
                                    <span className="text-slate-400">Physical Zone</span>
                                    <span className="text-white font-semibold">{zones.find(z => z.id === mapSelectedZone)?.name.split(' (')[0]}</span>
                                  </div>
                                  <div className="flex justify-between py-1.5 border-b border-slate-800/50">
                                    <span className="text-slate-400">Reorder Threshold</span>
                                    <span className="text-white font-semibold">{item.minThreshold} {item.unit}</span>
                                  </div>
                                  <div className="flex justify-between py-1.5">
                                    <span className="text-slate-400">Assigned Supplier</span>
                                    <span className="text-white font-semibold truncate max-w-40">{supplier?.name || 'Unassigned'}</span>
                                  </div>
                                </div>

                                {item.notes && (
                                  <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-850">
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Notes</span>
                                    <p className="text-xs text-slate-400 leading-relaxed italic">{item.notes}</p>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-center py-12" id="inspector_empty_cell">
                                <Package className="h-12 w-12 text-slate-600 mx-auto mb-3 opacity-40" />
                                <h4 className="text-sm font-bold text-slate-300 mb-1">Empty Storage Slot</h4>
                                <p className="text-xs text-slate-500 max-w-64 mx-auto leading-relaxed">
                                  No product is assigned to this shelf grid coordinate. You can record a product with this slot designation in the stock directory.
                                </p>
                              </div>
                            )}

                            {/* Adjustment action shortcuts */}
                            {item && (
                              <div className="mt-6 pt-5 border-t border-slate-800/80 space-y-2">
                                <button 
                                  id={`btn_inspect_inbound`}
                                  onClick={() => openAdjustModal(item, 'INBOUND')}
                                  className="w-full py-2 px-4 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-slate-950 border border-emerald-500/15 font-bold text-xs rounded-xl transition flex items-center justify-center gap-2"
                                >
                                  <ArrowDownLeft className="h-4 w-4" />
                                  Log Inbound Intake Delivery
                                </button>
                                <button 
                                  id={`btn_inspect_outbound`}
                                  onClick={() => openAdjustModal(item, 'OUTBOUND')}
                                  disabled={item.quantity === 0}
                                  className="w-full py-2 px-4 bg-amber-500/10 text-amber-400 hover:bg-amber-500 hover:text-slate-950 border border-amber-500/15 font-bold text-xs rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  <ArrowUpRight className="h-4 w-4" />
                                  Log Outbound Dispatch Order
                                </button>
                              </div>
                            )}
                          </div>

                          <button 
                            id="btn_close_inspector"
                            onClick={() => setSelectedMapCell(null)}
                            className="w-full py-2 border border-slate-800 hover:bg-slate-900 rounded-xl text-xs text-slate-400 transition"
                          >
                            Close Slot Inspector
                          </button>
                        </div>
                      );
                    })() : (
                      <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-2xl h-full flex flex-col items-center justify-center text-center text-slate-500" id="map_cell_no_selection">
                        <MapPin className="h-12 w-12 text-slate-600 mb-3 opacity-40 animate-pulse" />
                        <h4 className="text-sm font-bold text-slate-300 mb-1">Audit Auditor Idle</h4>
                        <p className="text-xs text-slate-500 max-w-64 leading-relaxed">
                          Click on any rack slot grid cell in the elevation model to load its physical properties and active inventory counts.
                        </p>
                      </div>
                    )}
                  </div>

                </div>

              </div>
            )}

            {/* 4. RECENT ADJUSTMENTS AUDIT FLOW PANEL */}
            {activeTab === 'history' && (
              <div className="space-y-6 animate-fade-in" id="panel_history">
                
                {/* Audit trail stats summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6" id="history_stats_cards">
                  <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-xl flex items-center gap-3">
                    <History className="h-5 w-5 text-indigo-400" />
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">Total Logged Movements</span>
                      <span className="text-lg font-bold text-white">{transactions.length} entries</span>
                    </div>
                  </div>
                  <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-xl flex items-center gap-3">
                    <ArrowDownLeft className="h-5 w-5 text-emerald-400" />
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">Inbound Intake Loggings</span>
                      <span className="text-lg font-bold text-white">
                        {transactions.filter(t => t.type === 'INBOUND').length} records
                      </span>
                    </div>
                  </div>
                  <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-xl flex items-center gap-3">
                    <ArrowUpRight className="h-5 w-5 text-amber-400" />
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">Outbound Dispatches</span>
                      <span className="text-lg font-bold text-white">
                        {transactions.filter(t => t.type === 'OUTBOUND').length} dispatches
                      </span>
                    </div>
                  </div>
                </div>

                {/* HISTORICAL TABLE LIST */}
                <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl overflow-hidden shadow-xl" id="history_table_panel">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse animate-fade-in" id="tbl_history">
                      <thead>
                        <tr className="bg-slate-950/80 border-b border-slate-800/80 text-xs font-bold text-slate-400 uppercase tracking-widest">
                          <th className="py-4.5 px-6">Timestamp UTC</th>
                          <th className="py-4.5 px-6">Product Item</th>
                          <th className="py-4.5 px-6">SKU Identifier</th>
                          <th className="py-4.5 px-6">Flow Direction</th>
                          <th className="py-4.5 px-6 text-right">Adjustment Qty</th>
                          <th className="py-4.5 px-6">Logging Operator</th>
                          <th className="py-4.5 px-6">Operation Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50 text-sm">
                        {transactions.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-12 text-center text-slate-500">
                              <History className="h-10 w-10 mx-auto mb-3 opacity-30" />
                              Audit log contains zero adjustment logs.
                            </td>
                          </tr>
                        ) : (
                          transactions.map(tx => {
                            const isInbound = tx.type === 'INBOUND';
                            
                            return (
                              <tr key={tx.id} className="hover:bg-slate-900/20 transition-colors" id={`row_tx_${tx.id}`}>
                                {/* Timestamp */}
                                <td className="py-4 px-6 font-mono text-xs text-slate-400">
                                  {new Date(tx.timestamp).toLocaleString(undefined, {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit'
                                  })}
                                </td>

                                {/* Item Name */}
                                <td className="py-4 px-6 font-bold text-slate-100">
                                  {tx.itemName}
                                </td>

                                {/* SKU */}
                                <td className="py-4 px-6 font-mono font-bold text-xs">
                                  <span className="px-2 py-0.5 bg-slate-950 text-slate-400 border border-slate-850 rounded">
                                    {tx.sku}
                                  </span>
                                </td>

                                {/* Type Tag */}
                                <td className="py-4 px-6">
                                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold tracking-widest uppercase border ${
                                    isInbound 
                                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                                      : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                  }`}>
                                    {isInbound ? <ArrowDownLeft className="h-3.5 w-3.5 shrink-0" /> : <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />}
                                    {tx.type}
                                  </span>
                                </td>

                                {/* Qty */}
                                <td className={`py-4 px-6 text-right font-bold font-mono text-base ${isInbound ? 'text-emerald-400' : 'text-amber-400'}`}>
                                  {isInbound ? '+' : '-'}{tx.quantity}
                                </td>

                                {/* Operator */}
                                <td className="py-4 px-6 text-xs text-slate-300 font-medium">
                                  {tx.operator}
                                </td>

                                {/* Reason comment */}
                                <td className="py-4 px-6 text-xs text-slate-400 italic">
                                  {tx.reason}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            )}

            {/* 5. SUPPLIERS & PROCUREMENT PLANNER VIEW */}
            {activeTab === 'suppliers' && (
              <div className="space-y-8 animate-fade-in" id="panel_suppliers">
                
                {/* ACTIVE SUPPLIERS DIRECTORY */}
                <div>
                  <h3 className="text-lg font-bold text-white mb-4">Active Supplier Contacts</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" id="suppliers_grid">
                    {suppliers.map(sup => {
                      const supItems = items.filter(i => i.supplierId === sup.id);
                      
                      return (
                        <div key={sup.id} className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-2xl flex flex-col justify-between" id={`card_supplier_${sup.id}`}>
                          <div className="space-y-3.5">
                            <div className="border-b border-slate-800 pb-3">
                              <h4 className="text-base font-bold text-white truncate">{sup.name}</h4>
                              <span className="text-xs text-slate-400 font-semibold italic">Contact: {sup.contactName}</span>
                            </div>

                            <div className="space-y-1.5 text-xs text-slate-300">
                              <div className="flex items-center gap-2">
                                <Mail className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                                <span className="truncate">{sup.email}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Phone className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                                <span>{sup.phone}</span>
                              </div>
                              <div className="flex items-start gap-2">
                                <MapPin className="h-3.5 w-3.5 text-indigo-400 shrink-0 mt-0.5" />
                                <span className="line-clamp-2 leading-relaxed">{sup.address}</span>
                              </div>
                            </div>
                          </div>

                          <div className="border-t border-slate-800/85 mt-4 pt-3 flex items-center justify-between text-xs text-slate-400">
                            <span>Manages {supItems.length} active lines</span>
                            <span className="font-mono text-indigo-400 font-bold bg-indigo-500/10 px-2 py-0.5 rounded">
                              ID: {sup.id}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* AUTOMATED PROCUREMENT ORDER PLANNER */}
                <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-2xl" id="procurement_planner">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-5">
                    <div className="flex items-center gap-2.5">
                      <ShoppingBag className="h-5.5 w-5.5 text-indigo-400" />
                      <div>
                        <h3 className="text-base font-bold text-white">Smart Procurement Auto-Reorder Planner</h3>
                        <p className="text-xs text-slate-400 mt-0.5">Scans active inventory for items below reorder thresholds, grouping replenishment plans by supplier.</p>
                      </div>
                    </div>
                    
                    <span className="bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 text-xs font-bold px-3 py-1.5 rounded-full">
                      {lowStockCount} items below safety thresholds
                    </span>
                  </div>

                  {lowStockCount === 0 ? (
                    <div className="py-12 text-center text-slate-500 max-w-lg mx-auto">
                      <Check className="h-10 w-10 text-emerald-400 mx-auto mb-3 bg-emerald-500/10 p-2 rounded-full" />
                      <h4 className="text-sm font-bold text-slate-300 mb-1">Procurement Buffer Optimal</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        No products are currently triggered below safety threshold parameters. The procurement algorithm has zero recommended reorder lines.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {suppliers.map(sup => {
                        const supLowItems = lowStockItems.filter(i => i.supplierId === sup.id);
                        if (supLowItems.length === 0) return null;

                        // Recommended restock is: twice the minThreshold minus the current quantity
                        const restockList = supLowItems.map(item => {
                          const recommendation = Math.max((item.minThreshold * 2) - item.quantity, 10);
                          return {
                            ...item,
                            recommendedQty: recommendation,
                            estCost: recommendation * item.price
                          };
                        });

                        const totalEstCost = restockList.reduce((sum, item) => sum + item.estCost, 0);

                        return (
                          <div key={sup.id} className="p-5 rounded-xl bg-slate-950/50 border border-slate-850" id={`procure_supplier_block_${sup.id}`}>
                            <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800 pb-3 mb-4 gap-3">
                              <div>
                                <h4 className="text-sm font-bold text-white">{sup.name}</h4>
                                <span className="text-xs text-slate-400">Reorder draft contains {restockList.length} triggered lines</span>
                              </div>
                              
                              <div className="flex items-center gap-4 text-xs font-semibold">
                                <span className="text-slate-400">
                                  Estimated Capital: <span className="text-white font-mono font-bold">${totalEstCost.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                                </span>
                                
                                <button 
                                  id={`btn_procure_order_${sup.id}`}
                                  onClick={() => handleTransmitRestock(sup.id, restockList.map(r => ({ id: r.id, qty: r.recommendedQty })))}
                                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-xs shadow-md transition flex items-center gap-1.5"
                                >
                                  <ShoppingBag className="h-3.5 w-3.5" />
                                  Transmit Restock PO
                                </button>
                              </div>
                            </div>

                            {/* Item lines list table */}
                            <div className="space-y-2">
                              {restockList.map(r => (
                                <div key={r.id} className="flex flex-col md:flex-row md:items-center justify-between p-3 rounded-lg bg-slate-900/40 border border-slate-800/60 text-xs gap-2">
                                  <div className="flex items-center gap-3">
                                    <span className="font-mono font-bold text-amber-500 bg-amber-500/5 border border-amber-500/10 px-2 py-0.5 rounded">
                                      {r.sku}
                                    </span>
                                    <div>
                                      <span className="text-slate-100 font-bold block">{r.name}</span>
                                      <span className="text-slate-400 mt-0.5 block">
                                        Current stock: <span className="text-rose-400 font-semibold">{r.quantity} {r.unit}</span> (Min Threshold: {r.minThreshold})
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-4 text-right">
                                    <div>
                                      <span className="text-slate-400">Recommended Replenish:</span>
                                      <span className="text-emerald-400 font-bold block">+{r.recommendedQty} {r.unit}</span>
                                    </div>
                                    <div className="w-24">
                                      <span className="text-slate-400">Subtotal value:</span>
                                      <span className="text-slate-100 font-bold block font-mono">${r.estCost.toFixed(2)}</span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                </div>

              </div>
            )}

          </div>

          {/* SYSTEM CONTAINER FOOTER */}
          <footer id="siwm_footer" className="px-8 py-5 border-t border-slate-800/80 text-center text-xs text-slate-500 bg-slate-950/40">
            <p>© 2026 Smart Inventory & Warehouse Management Systems. All rights reserved. Persistent SQLite-local cached DB layer enabled.</p>
          </footer>
        </main>

      </div>

      {/* ==================== FORM MODAL 1: ADD PRODUCT RECORD ==================== */}
      {isAddModalOpen && (
        <div id="modal_add_item" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl relative animate-scale-up text-slate-200">
            <h3 className="text-lg font-bold text-white border-b border-slate-800 pb-3 mb-5 flex items-center gap-2">
              <Plus className="h-5.5 w-5.5 text-indigo-400" />
              Add Product Line To Warehouse
            </h3>

            <form onSubmit={handleSaveItem} className="space-y-4">
              
              {/* Row 1: Name and SKU */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Product Name *</label>
                  <input 
                    id="form_add_name"
                    type="text" 
                    required
                    value={itemForm.name}
                    onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-250 focus:ring-1 focus:ring-indigo-500 outline-none"
                    placeholder="e.g. MX Master Mouse 3S"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">SKU Designation *</label>
                  <input 
                    id="form_add_sku"
                    type="text" 
                    required
                    value={itemForm.sku}
                    onChange={(e) => setItemForm({ ...itemForm, sku: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-250 font-mono focus:ring-1 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>

              {/* Row 2: Category and Supplier */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Category Slot</label>
                  <select 
                    id="form_add_category"
                    value={itemForm.category}
                    onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-250 focus:ring-1 focus:ring-indigo-500 outline-none"
                  >
                    {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Authorized Supplier</label>
                  <select 
                    id="form_add_supplier"
                    value={itemForm.supplierId}
                    onChange={(e) => setItemForm({ ...itemForm, supplierId: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-250 focus:ring-1 focus:ring-indigo-500 outline-none"
                  >
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Row 3: Price and Threshold */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Unit Cost (USD $)</label>
                  <input 
                    id="form_add_price"
                    type="number" 
                    step="0.01"
                    min="0"
                    value={itemForm.price}
                    onChange={(e) => setItemForm({ ...itemForm, price: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-250 focus:ring-1 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Safety Stock Threshold</label>
                  <input 
                    id="form_add_threshold"
                    type="number" 
                    min="1"
                    value={itemForm.minThreshold}
                    onChange={(e) => setItemForm({ ...itemForm, minThreshold: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-250 focus:ring-1 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>

              {/* Row 4: Initial Quantity & Units */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Initial Quantity</label>
                  <input 
                    id="form_add_quantity"
                    type="number" 
                    min="0"
                    value={itemForm.quantity}
                    onChange={(e) => setItemForm({ ...itemForm, quantity: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-250 focus:ring-1 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Measurement Unit</label>
                  <select 
                    id="form_add_unit"
                    value={itemForm.unit}
                    onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-250 focus:ring-1 focus:ring-indigo-500 outline-none"
                  >
                    <option value="pcs">pcs (individual items)</option>
                    <option value="boxes">boxes</option>
                    <option value="pallets">pallets</option>
                    <option value="kg">kg</option>
                    <option value="liters">liters</option>
                  </select>
                </div>
              </div>

              {/* Row 5: Warehouse Location layout slots */}
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-850 space-y-3">
                <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider block">Storage Racking Address</span>
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <label className="text-[9px] text-slate-500 font-bold block mb-1">Zone</label>
                    <select 
                      id="form_add_zone"
                      value={itemForm.zone}
                      onChange={(e) => setItemForm({ ...itemForm, zone: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-[11px] outline-none"
                    >
                      {zones.map(z => <option key={z.id} value={z.name}>{z.id}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 font-bold block mb-1">Aisle</label>
                    <select 
                      id="form_add_aisle"
                      value={itemForm.aisle}
                      onChange={(e) => setItemForm({ ...itemForm, aisle: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-[11px] outline-none"
                    >
                      <option value="Aisle 01">Aisle 01</option>
                      <option value="Aisle 02">Aisle 02</option>
                      <option value="Aisle 03">Aisle 03</option>
                      <option value="Aisle 04">Aisle 04</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 font-bold block mb-1">Level</label>
                    <select 
                      id="form_add_shelf"
                      value={itemForm.shelf}
                      onChange={(e) => setItemForm({ ...itemForm, shelf: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-[11px] outline-none"
                    >
                      <option value="Level 1">Level 1 (Lower)</option>
                      <option value="Level 2">Level 2 (Mid)</option>
                      <option value="Level 3">Level 3 (High-Rack)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 font-bold block mb-1">Bin</label>
                    <select 
                      id="form_add_bin"
                      value={itemForm.bin}
                      onChange={(e) => setItemForm({ ...itemForm, bin: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-[11px] outline-none"
                    >
                      <option value="Bin 01">Bin 01</option>
                      <option value="Bin 02">Bin 02</option>
                      <option value="Bin 05">Bin 05</option>
                      <option value="Bin 11">Bin 11</option>
                      <option value="Bin 15">Bin 15</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Comments / Handling Instructions</label>
                <textarea 
                  id="form_add_notes"
                  rows={2}
                  value={itemForm.notes}
                  onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })}
                  placeholder="e.g. Fragile tech stock, keep boxes upright."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-250 focus:ring-1 focus:ring-indigo-500 outline-none"
                />
              </div>

              <div className="border-t border-slate-800/85 pt-4 mt-5 flex items-center justify-end gap-3">
                <button 
                  id="btn_cancel_add"
                  type="button" 
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-slate-200 transition"
                >
                  Cancel
                </button>
                <button 
                  id="btn_submit_add"
                  type="submit" 
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl transition"
                >
                  Submit Active SKU
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* ==================== FORM MODAL 2: EDIT PRODUCT RECORD ==================== */}
      {isEditModalOpen && (
        <div id="modal_edit_item" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl relative animate-scale-up text-slate-200">
            <h3 className="text-lg font-bold text-white border-b border-slate-800 pb-3 mb-5 flex items-center gap-2">
              <Edit3 className="h-5.5 w-5.5 text-indigo-400" />
              Edit Product Properties
            </h3>

            <form onSubmit={handleSaveItem} className="space-y-4">
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Product Name *</label>
                  <input 
                    id="form_edit_name"
                    type="text" 
                    required
                    value={itemForm.name}
                    onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-250 focus:ring-1 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">SKU Designation *</label>
                  <input 
                    id="form_edit_sku"
                    type="text" 
                    required
                    value={itemForm.sku}
                    onChange={(e) => setItemForm({ ...itemForm, sku: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-250 font-mono focus:ring-1 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Category Slot</label>
                  <select 
                    id="form_edit_category"
                    value={itemForm.category}
                    onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-250 focus:ring-1 focus:ring-indigo-500 outline-none"
                  >
                    {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Authorized Supplier</label>
                  <select 
                    id="form_edit_supplier"
                    value={itemForm.supplierId}
                    onChange={(e) => setItemForm({ ...itemForm, supplierId: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-250 focus:ring-1 focus:ring-indigo-500 outline-none"
                  >
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Unit Cost (USD $)</label>
                  <input 
                    id="form_edit_price"
                    type="number" 
                    step="0.01"
                    min="0"
                    value={itemForm.price}
                    onChange={(e) => setItemForm({ ...itemForm, price: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-250 focus:ring-1 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Safety Stock Threshold</label>
                  <input 
                    id="form_edit_threshold"
                    type="number" 
                    min="1"
                    value={itemForm.minThreshold}
                    onChange={(e) => setItemForm({ ...itemForm, minThreshold: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-250 focus:ring-1 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>

              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-850 space-y-3">
                <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider block">Storage Racking Address</span>
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <label className="text-[9px] text-slate-500 font-bold block mb-1">Zone</label>
                    <select 
                      id="form_edit_zone"
                      value={itemForm.zone}
                      onChange={(e) => setItemForm({ ...itemForm, zone: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-[11px] outline-none"
                    >
                      {zones.map(z => <option key={z.id} value={z.name}>{z.id}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 font-bold block mb-1">Aisle</label>
                    <select 
                      id="form_edit_aisle"
                      value={itemForm.aisle}
                      onChange={(e) => setItemForm({ ...itemForm, aisle: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-[11px] outline-none"
                    >
                      <option value="Aisle 01">Aisle 01</option>
                      <option value="Aisle 02">Aisle 02</option>
                      <option value="Aisle 03">Aisle 03</option>
                      <option value="Aisle 04">Aisle 04</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 font-bold block mb-1">Level</label>
                    <select 
                      id="form_edit_shelf"
                      value={itemForm.shelf}
                      onChange={(e) => setItemForm({ ...itemForm, shelf: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-[11px] outline-none"
                    >
                      <option value="Level 1">Level 1</option>
                      <option value="Level 2">Level 2</option>
                      <option value="Level 3">Level 3</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 font-bold block mb-1">Bin</label>
                    <select 
                      id="form_edit_bin"
                      value={itemForm.bin}
                      onChange={(e) => setItemForm({ ...itemForm, bin: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-[11px] outline-none"
                    >
                      <option value="Bin 01">Bin 01</option>
                      <option value="Bin 02">Bin 02</option>
                      <option value="Bin 05">Bin 05</option>
                      <option value="Bin 11">Bin 11</option>
                      <option value="Bin 15">Bin 15</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Comments / Handling Instructions</label>
                <textarea 
                  id="form_edit_notes"
                  rows={2}
                  value={itemForm.notes}
                  onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-250 focus:ring-1 focus:ring-indigo-500 outline-none"
                />
              </div>

              <div className="border-t border-slate-800/85 pt-4 mt-5 flex items-center justify-end gap-3">
                <button 
                  id="btn_cancel_edit"
                  type="button" 
                  onClick={() => {
                    setIsEditModalOpen(false);
                    setEditingItem(null);
                  }}
                  className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-slate-200 transition"
                >
                  Cancel
                </button>
                <button 
                  id="btn_submit_edit"
                  type="submit" 
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl transition"
                >
                  Save Changes
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* ==================== FORM MODAL 3: INBOUND/OUTBOUND ADJUSTMENT ==================== */}
      {isAdjustModalOpen && adjustingItem && (
        <div id="modal_adjust_item" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative animate-scale-up text-slate-200">
            <h3 className="text-lg font-bold text-white border-b border-slate-800 pb-3 mb-4 flex items-center gap-2">
              <History className="h-5.5 w-5.5 text-indigo-400 animate-spin" />
              Adjust Physical Balance
            </h3>

            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-850 mb-5 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-400">Designation:</span>
                <span className="font-bold text-white text-right">{adjustingItem.name}</span>
              </div>
              <div className="flex justify-between font-mono">
                <span className="text-slate-400">SKU Code:</span>
                <span className="font-bold text-indigo-400">{adjustingItem.sku}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Current Balance:</span>
                <span className="font-bold text-emerald-400">{adjustingItem.quantity} {adjustingItem.unit}</span>
              </div>
            </div>

            <form onSubmit={handleSaveAdjustment} className="space-y-4">
              
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Movement Flow</label>
                <div className="grid grid-cols-2 gap-2">
                  <button 
                    id="btn_adjust_inbound"
                    type="button"
                    onClick={() => setAdjustForm({ ...adjustForm, type: 'INBOUND', reason: 'Purchase Order Received' })}
                    className={`py-2 px-3 rounded-lg font-bold text-xs border transition flex items-center justify-center gap-2 ${
                      adjustForm.type === 'INBOUND'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-slate-950 text-slate-500 border-slate-850 hover:text-slate-300'
                    }`}
                  >
                    <ArrowDownLeft className="h-4 w-4" />
                    Inbound Intake
                  </button>
                  <button 
                    id="btn_adjust_outbound"
                    type="button"
                    onClick={() => setAdjustForm({ ...adjustForm, type: 'OUTBOUND', reason: 'Customer Shipment Dispatch' })}
                    className={`py-2 px-3 rounded-lg font-bold text-xs border transition flex items-center justify-center gap-2 ${
                      adjustForm.type === 'OUTBOUND'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        : 'bg-slate-950 text-slate-500 border-slate-850 hover:text-slate-300'
                    }`}
                  >
                    <ArrowUpRight className="h-4 w-4" />
                    Outbound Dispatch
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Adjust Quantity</label>
                  <input 
                    id="form_adjust_qty"
                    type="number" 
                    min="1"
                    required
                    value={adjustForm.quantity}
                    onChange={(e) => setAdjustForm({ ...adjustForm, quantity: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-250 focus:ring-1 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Authorized Operator</label>
                  <input 
                    id="form_adjust_operator"
                    type="text" 
                    required
                    value={adjustForm.operator}
                    onChange={(e) => setAdjustForm({ ...adjustForm, operator: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-250 focus:ring-1 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Operation Reason</label>
                <select 
                  id="form_adjust_reason"
                  value={adjustForm.reason}
                  onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-250 focus:ring-1 focus:ring-indigo-500 outline-none"
                >
                  {adjustForm.type === 'INBOUND' ? (
                    <>
                      <option value="Purchase Order Received">Purchase Order Received</option>
                      <option value="Supplier Bulk Intake">Supplier Bulk Intake</option>
                      <option value="Customer Return">Customer Return</option>
                      <option value="Inventory Audit Adjustment">Inventory Audit Adjustment</option>
                    </>
                  ) : (
                    <>
                      <option value="Customer Shipment Dispatch">Customer Shipment Dispatch</option>
                      <option value="Internal Site Dispensation">Internal Site Dispensation</option>
                      <option value="Perishable Disposal (Damaged/Leaking)">Perishable Disposal (Damaged/Leaking)</option>
                      <option value="Inventory Audit Adjustment">Inventory Audit Adjustment</option>
                    </>
                  )}
                </select>
              </div>

              <div className="border-t border-slate-800/85 pt-4 mt-5 flex items-center justify-end gap-3">
                <button 
                  id="btn_cancel_adjust"
                  type="button" 
                  onClick={() => {
                    setIsAdjustModalOpen(false);
                    setAdjustingItem(null);
                  }}
                  className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-slate-200 transition"
                >
                  Cancel
                </button>
                <button 
                  id="btn_submit_adjust"
                  type="submit" 
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl transition"
                >
                  Submit Balance Adjustment
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

    </div>
  );
}
