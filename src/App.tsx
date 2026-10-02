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
  RotateCcw,
  Lock,
  Building2,
  KeyRound,
  Copy,
  ArrowRight,
  Settings,
  ShieldCheck,
  UserPlus,
  Layers,
  Tag,
  Truck,
  Activity
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

import { PasswordChangeCard } from './components/PasswordChangeCard';
import { AuditLedgerView } from './components/AuditLedgerView';
import { PersonnelDispatchesView } from './components/PersonnelDispatchesView';
import { PurchaseOrdersManager } from './components/PurchaseOrdersManager';

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

const getZoneDisplayName = (zoneVal: string | null | undefined, zonesList?: any[]): string => {
  if (!zoneVal) return '';
  
  let rawName = zoneVal;
  if (zonesList && zonesList.length > 0) {
    const foundZone = zonesList.find(z => z.id === zoneVal || z.name === zoneVal);
    if (foundZone) {
      rawName = foundZone.name;
    }
  }

  // Strip trailing timestamp suffix like -1783720324158 and any preceding dashes
  let clean = rawName.replace(/-\d{9,}$/, '').trim();
  
  // Clean common placeholder words
  clean = clean.replace('Warehouse Zone', '').replace('Storage', '').trim();
  return clean || zoneVal;
};

export default function App() {
  // --- Persistent State ---
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [transactions, setTransactions] = useState<StockTransaction[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [zones, setZones] = useState<WarehouseZone[]>(INITIAL_ZONES);
  const [loading, setLoading] = useState(true);

  // --- Authentication & Multi-Tenancy States ---
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('siwm_token'));
  const [user, setUser] = useState<any>(() => {
    const saved = localStorage.getItem('siwm_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [warehouse, setWarehouse] = useState<any>(() => {
    const saved = localStorage.getItem('siwm_warehouse');
    return saved ? JSON.parse(saved) : null;
  });
  const [warehouses, setWarehouses] = useState<any[]>(() => {
    const saved = localStorage.getItem('siwm_warehouses');
    return saved ? JSON.parse(saved) : [];
  });
  const [userRole, setUserRole] = useState<'admin' | 'manager' | 'operator' | 'engineer' | 'viewer'>('viewer');
  const [warehouseUsers, setWarehouseUsers] = useState<any[]>([]);

  // Auth form states
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [warehouseOption, setWarehouseOption] = useState<'create' | 'join'>('create');
  const [warehouseName, setWarehouseName] = useState('');
  const [warehouseAddress, setWarehouseAddress] = useState('');
  const [warehouseCode, setWarehouseCode] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState('');

  // Secondary warehouse form states
  const [isSecondWhModalOpen, setIsSecondWhModalOpen] = useState(false);
  const [secondWhOption, setSecondWhOption] = useState<'create' | 'join'>('create');
  const [secondWhName, setSecondWhName] = useState('');
  const [secondWhAddress, setSecondWhAddress] = useState('');
  const [secondWhCode, setSecondWhCode] = useState('');
  const [secondWhSubmitting, setSecondWhSubmitting] = useState(false);
  const [secondWhError, setSecondWhError] = useState('');

  // Reset database modal states
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState('');

  // Wipe-my-account-and-warehouse states (admin-only, requires an authenticated,
  // existing account - this can never run for a logged-out visitor)
  const [isSystemWipeModalOpen, setIsSystemWipeModalOpen] = useState(false);
  const [systemWipeConfirmWord, setSystemWipeConfirmWord] = useState('');
  const [systemWipePassword, setSystemWipePassword] = useState('');
  const [systemWipeSubmitting, setSystemWipeSubmitting] = useState(false);
  const [systemWipeError, setSystemWipeError] = useState('');

  const handleLogout = () => {
    localStorage.removeItem('siwm_token');
    localStorage.removeItem('siwm_user');
    localStorage.removeItem('siwm_warehouse');
    localStorage.removeItem('siwm_warehouses');
    setToken(null);
    setUser(null);
    setWarehouse(null);
    setWarehouses([]);
    setItems([]);
    setTransactions([]);
    setSuppliers([]);
    setCategories([]);
    showToast("Signed out securely.", "info");
  };

  const fetchData = async (activeToken?: string) => {
    const tokenToUse = activeToken || token;
    if (!tokenToUse) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/data', {
        headers: {
          'Authorization': `Bearer ${tokenToUse}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setTransactions(data.transactions || []);
        setSuppliers(data.suppliers || []);
        setCategories(data.categories || []);
        const fetchedZones = data.zones || [];
        setZones(fetchedZones);
        if (fetchedZones.length > 0) {
          setMapSelectedZone(prev => fetchedZones.some((z: any) => z.id === prev) ? prev : fetchedZones[0].id);
        }
        
        // Save user role, member operator list and warehouse details
        if (data.userRole) {
          setUserRole(data.userRole);
        }
        if (data.warehouseUsers) {
          setWarehouseUsers(data.warehouseUsers);
        }
        if (data.warehouse) {
          setWarehouse(data.warehouse);
          localStorage.setItem('siwm_warehouse', JSON.stringify(data.warehouse));
        }

        // Also refresh associated warehouses list dynamically
        const whRes = await fetch('/api/auth/warehouses', {
          headers: {
            'Authorization': `Bearer ${tokenToUse}`
          }
        });
        if (whRes.ok) {
          const whData = await whRes.json();
          setWarehouses(whData.warehouses || []);
          localStorage.setItem('siwm_warehouses', JSON.stringify(whData.warehouses || []));
        }
      } else if (res.status === 401 || res.status === 403) {
        handleLogout();
        showToast("Your session has expired. Please sign in again.", "error");
      } else {
        showToast("Failed to retrieve your registered warehouse dataset.", "error");
      }
    } catch (err) {
      console.error("Database fetch error:", err);
      showToast("Central database connection error.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchWarehouse = async (targetId: string) => {
    try {
      setLoading(true);
      const res = await fetch('/api/auth/warehouses/switch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ warehouseId: targetId })
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('siwm_token', data.token);
        localStorage.setItem('siwm_warehouse', JSON.stringify(data.warehouse));
        if (data.warehouses) {
          localStorage.setItem('siwm_warehouses', JSON.stringify(data.warehouses));
          setWarehouses(data.warehouses);
        }
        setToken(data.token);
        setWarehouse(data.warehouse);
        showToast(`Workspace context switched to: ${data.warehouse.name}`, 'success');
        fetchData(data.token);
      } else {
        showToast(data.error || "Failed to switch warehouse context.", "error");
      }
    } catch (err) {
      showToast("Network error switching warehouse context.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleSecondWarehouseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSecondWhError('');
    setSecondWhSubmitting(true);

    try {
      const endpoint = secondWhOption === 'create' 
        ? '/api/auth/warehouses/create' 
        : '/api/auth/warehouses/join';

      const payload = secondWhOption === 'create'
        ? { name: secondWhName, address: secondWhAddress }
        : { code: secondWhCode.toUpperCase().trim() };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('siwm_token', data.token);
        localStorage.setItem('siwm_warehouse', JSON.stringify(data.warehouse));
        localStorage.setItem('siwm_warehouses', JSON.stringify(data.warehouses));
        setToken(data.token);
        setWarehouse(data.warehouse);
        setWarehouses(data.warehouses);
        setIsSecondWhModalOpen(false);
        setSecondWhName('');
        setSecondWhAddress('');
        setSecondWhCode('');
        showToast(secondWhOption === 'create' 
          ? `Workspace Established: Welcome to ${data.warehouse.name}`
          : `Connected to Workspace: Welcome to ${data.warehouse.name}`, 'success');
        confetti({ particleCount: 50, spread: 60 });
        fetchData(data.token);
      } else {
        setSecondWhError(data.error || "Failed to add warehouse.");
      }
    } catch (err) {
      setSecondWhError("Network error adding warehouse.");
    } finally {
      setSecondWhSubmitting(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchData();
    } else {
      setLoading(false);
    }
  }, [token]);

  // --- Auth Handlers ---
  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthSubmitting(true);

    try {
      if (isRegisterMode) {
        if (!authEmail || !authPassword || !authName) {
          setAuthError('Please fill out all required register fields.');
          setAuthSubmitting(false);
          return;
        }
        if (warehouseOption === 'create' && !warehouseName) {
          setAuthError('Warehouse designation is required to establish a new tenant space.');
          setAuthSubmitting(false);
          return;
        }
        if (warehouseOption === 'join' && !warehouseCode) {
          setAuthError('Warehouse clearance access code is required to join an existing tenant.');
          setAuthSubmitting(false);
          return;
        }

        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: authEmail,
            password: authPassword,
            name: authName,
            warehouseOption,
            warehouseName,
            warehouseAddress,
            warehouseCode: warehouseCode.toUpperCase().trim()
          })
        });

        const data = await res.json();
        if (res.ok) {
          localStorage.setItem('siwm_token', data.token);
          localStorage.setItem('siwm_user', JSON.stringify(data.user));
          localStorage.setItem('siwm_warehouse', JSON.stringify(data.warehouse));
          setToken(data.token);
          setUser(data.user);
          setWarehouse(data.warehouse);
          showToast(`Workspace Established: Welcome to ${data.warehouse.name}`, 'success');
          confetti({ particleCount: 50, spread: 60 });
        } else {
          setAuthError(data.error || 'Failed to complete tenant registration.');
        }
      } else {
        if (!authEmail || !authPassword) {
          setAuthError('Please enter both your email address and password.');
          setAuthSubmitting(false);
          return;
        }
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: authEmail,
            password: authPassword
          })
        });

        const data = await res.json();
        if (res.ok) {
          localStorage.setItem('siwm_token', data.token);
          localStorage.setItem('siwm_user', JSON.stringify(data.user));
          localStorage.setItem('siwm_warehouse', JSON.stringify(data.warehouse));
          setToken(data.token);
          setUser(data.user);
          setWarehouse(data.warehouse);
          showToast(`Access Granted: Welcome back, ${data.user.name}!`, 'success');
          confetti({ particleCount: 40, spread: 40 });
        } else {
          setAuthError(data.error || 'Invalid authentication credentials.');
        }
      }
    } catch (err) {
      setAuthError('Unable to connect to central authentication endpoint.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  // --- UI Navigation ---
  const [activeTab, setActiveTab] = useState<'dashboard' | 'inventory' | 'map' | 'history' | 'suppliers' | 'settings'>('dashboard');
  const [historySubTab, setHistorySubTab] = useState<'movements' | 'dispatches' | 'audit'>('movements');

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
  const [isAddSupplierModalOpen, setIsAddSupplierModalOpen] = useState(false);
  
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [adjustingItem, setAdjustingItem] = useState<InventoryItem | null>(null);

  // --- Supplier Form State ---
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    contactName: '',
    email: '',
    phone: '',
    address: ''
  });
  const [supplierSubmitting, setSupplierSubmitting] = useState(false);
  const [supplierError, setSupplierError] = useState('');

  // --- Zone Form State ---
  const [zoneForm, setZoneForm] = useState({
    name: '',
    description: '',
    maxCapacity: 100,
    color: 'indigo'
  });
  const [zoneSubmitting, setZoneSubmitting] = useState(false);
  const [zoneError, setZoneError] = useState('');

  // --- Category Form State ---
  const [categoryForm, setCategoryForm] = useState({
    name: '',
    description: '',
    color: 'emerald'
  });
  const [categorySubmitting, setCategorySubmitting] = useState(false);
  const [categoryError, setCategoryError] = useState('');

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
    operator: 'Operator Station 01',
    outboundTargetType: 'engineer' as 'engineer' | 'warehouse',
    selectedEngineerId: '',
    selectedWarehouseId: '',
    customRecipientName: '',
    department: '',
    badgeNumber: '',
    projectCode: ''
  });

  // --- Procurement Planner state ---
  const [procurementSuppliers, setProcurementSuppliers] = useState<Record<string, boolean>>({});

  // --- Warehouse Configuration & Permissions States ---
  const [whForm, setWhForm] = useState({
    name: '',
    address: '',
    email: '',
    phone: '',
    contactName: '',
    layoutRows: 5,
    layoutCols: 5,
    layoutZones: [] as string[]
  });
  const [inviteForm, setInviteForm] = useState({
    email: '',
    name: '',
    role: 'operator' as 'admin' | 'manager' | 'operator' | 'engineer' | 'viewer'
  });
  const [whSaving, setWhSaving] = useState(false);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);

  useEffect(() => {
    if (warehouse) {
      let zonesParsed = [] as string[];
      try {
        zonesParsed = warehouse.layout_zones ? (typeof warehouse.layout_zones === 'string' ? JSON.parse(warehouse.layout_zones) : warehouse.layout_zones) : [];
      } catch (err) {
        zonesParsed = [];
      }
      setWhForm({
        name: warehouse.name || '',
        address: warehouse.address || '',
        email: warehouse.email || '',
        phone: warehouse.phone || '',
        contactName: warehouse.contact_name || '',
        layoutRows: warehouse.layout_rows || 5,
        layoutCols: warehouse.layout_cols || 5,
        layoutZones: zonesParsed
      });
    }
  }, [warehouse]);

  // --- Help Toast/Banner ---
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // --- Warehouse Configuration & Permissions Handlers ---
  const handleSaveWarehouseSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userRole !== 'admin') {
      showToast("Access Denied: Only Administrators can edit warehouse setup.", "error");
      return;
    }
    setWhSaving(true);
    try {
      const res = await fetch('/api/warehouse', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: whForm.name,
          address: whForm.address,
          email: whForm.email,
          phone: whForm.phone,
          contact_name: whForm.contactName,
          layout_rows: whForm.layoutRows,
          layout_cols: whForm.layoutCols,
          layout_zones: whForm.layoutZones
        })
      });
      const data = await res.json();
      if (res.ok) {
        showToast("Warehouse configuration updated successfully.", "success");
        await fetchData();
      } else {
        showToast(data.error || "Failed to update warehouse settings.", "error");
      }
    } catch (err) {
      showToast("Connection failed saving settings.", "error");
    } finally {
      setWhSaving(false);
    }
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userRole !== 'admin') {
      showToast("Access Denied: Only Administrators can manage operators.", "error");
      return;
    }
    if (!inviteForm.email.trim()) {
      showToast("Please enter an email address.", "error");
      return;
    }
    setInviteSubmitting(true);
    try {
      const res = await fetch('/api/warehouse/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          email: inviteForm.email,
          name: inviteForm.name,
          role: inviteForm.role
        })
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || "Operator authorized successfully.", "success");
        setInviteForm({ email: '', name: '', role: 'operator' });
        await fetchData();
      } else {
        showToast(data.error || "Failed to add operator.", "error");
      }
    } catch (err) {
      showToast("Connection failed inviting operator.", "error");
    } finally {
      setInviteSubmitting(false);
    }
  };

  const handleUpdateUserRole = async (userId: string, targetRole: string) => {
    if (userRole !== 'admin') {
      showToast("Access Denied: Only Administrators can edit operator roles.", "error");
      return;
    }
    try {
      const res = await fetch(`/api/warehouse/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ role: targetRole })
      });
      const data = await res.json();
      if (res.ok) {
        showToast("Operator permissions updated successfully.", "success");
        await fetchData();
      } else {
        showToast(data.error || "Failed to update operator role.", "error");
      }
    } catch (err) {
      showToast("Connection failed updating permissions.", "error");
    }
  };

  const handleRemoveUser = async (userId: string) => {
    if (userRole !== 'admin') {
      showToast("Access Denied: Only Administrators can remove operators.", "error");
      return;
    }
    if (!window.confirm("Are you sure you want to revoke warehouse access for this operator?")) {
      return;
    }
    try {
      const res = await fetch(`/api/warehouse/users/${userId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (res.ok) {
        showToast("Operator access revoked successfully.", "success");
        await fetchData();
      } else {
        showToast(data.error || "Failed to remove operator.", "error");
      }
    } catch (err) {
      showToast("Connection failed removing operator.", "error");
    }
  };

  // --- Reset All Data Helper ---
  const handleResetData = () => {
    setResetPassword('');
    setResetError('');
    setIsResetModalOpen(true);
  };

  const handleResetDataSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');
    setResetSubmitting(true);
    try {
      const res = await fetch('/api/reset', { 
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ password: resetPassword })
      });
      const data = await res.json();
      if (res.ok) {
        setIsResetModalOpen(false);
        setResetPassword('');
        await fetchData();
        showToast("Warehouse database has been restored to factory defaults", "info");
        confetti({ particleCount: 30, spread: 40 });
      } else {
        setResetError(data.error || "Failed to reset central database.");
      }
    } catch (err) {
      setResetError("Error resetting database. Check your connection.");
    } finally {
      setResetSubmitting(false);
    }
  };

  // --- Delete My Warehouse & Account Handlers (admin-only, own tenant only) ---
  const handleSystemWipe = () => {
    if (userRole !== 'admin') {
      showToast('Only Administrators can delete a warehouse and its data.', 'error');
      return;
    }
    setSystemWipeConfirmWord('');
    setSystemWipePassword('');
    setSystemWipeError('');
    setIsSystemWipeModalOpen(true);
  };

  const handleSystemWipeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (systemWipeConfirmWord.toUpperCase().trim() !== 'WIPE') {
      setSystemWipeError('Please type "WIPE" in all uppercase letters to authorize.');
      return;
    }
    if (!systemWipePassword) {
      setSystemWipeError('Please enter your password to confirm this irreversible action.');
      return;
    }

    setSystemWipeError('');
    setSystemWipeSubmitting(true);
    try {
      const res = await fetch('/api/account/wipe-my-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ password: systemWipePassword, confirm: 'WIPE' })
      });
      const data = await res.json();
      if (res.ok) {
        setIsSystemWipeModalOpen(false);
        setSystemWipeConfirmWord('');
        setSystemWipePassword('');

        // Log out immediately & clean state completely
        localStorage.removeItem('siwm_token');
        localStorage.removeItem('siwm_user');
        localStorage.removeItem('siwm_warehouse');
        localStorage.removeItem('siwm_warehouses');
        setToken(null);
        setUser(null);
        setWarehouse(null);
        setWarehouses([]);
        setItems([]);
        setTransactions([]);
        setSuppliers([]);
        setCategories([]);

        showToast("Your warehouse and account have been permanently deleted.", "info");
        confetti({ particleCount: 50, spread: 80 });
      } else {
        setSystemWipeError(data.error || "Failed to delete account and warehouse data.");
      }
    } catch (err) {
      setSystemWipeError("Network error occurred while deleting your account and warehouse data.");
    } finally {
      setSystemWipeSubmitting(false);
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
      aisle: mapAisles[0] || 'Aisle 01',
      shelf: mapShelves[0] || 'Level 1',
      bin: 'Bin 01',
      supplierId: suppliers[0]?.id || '',
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

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierForm.name) {
      setSupplierError("Supplier name is required.");
      return;
    }

    setSupplierSubmitting(true);
    setSupplierError('');

    try {
      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: supplierForm.name,
          contactName: supplierForm.contactName,
          email: supplierForm.email,
          phone: supplierForm.phone,
          address: supplierForm.address
        })
      });

      if (res.ok) {
        await fetchData();
        setIsAddSupplierModalOpen(false);
        setSupplierForm({
          name: '',
          contactName: '',
          email: '',
          phone: '',
          address: ''
        });
        showToast(`Supplier "${supplierForm.name}" registered successfully!`);
        if (typeof confetti === 'function') {
          confetti({ particleCount: 30, spread: 50 });
        }
      } else {
        const errData = await res.json();
        setSupplierError(errData.error || "Failed to save supplier.");
      }
    } catch (err) {
      setSupplierError("Error communicating with database.");
    } finally {
      setSupplierSubmitting(false);
    }
  };

  const handleSaveZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!zoneForm.name) {
      setZoneError("Zone name is required.");
      return;
    }

    setZoneSubmitting(true);
    setZoneError('');

    try {
      const res = await fetch('/api/zones', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: zoneForm.name,
          description: zoneForm.description,
          maxCapacity: Number(zoneForm.maxCapacity) || 100,
          color: zoneForm.color
        })
      });

      if (res.ok) {
        await fetchData();
        setZoneForm({
          name: '',
          description: '',
          maxCapacity: 100,
          color: 'indigo'
        });
        showToast(`Zone "${zoneForm.name}" created successfully!`);
        if (typeof confetti === 'function') {
          confetti({ particleCount: 20, spread: 40 });
        }
      } else {
        const errData = await res.json();
        setZoneError(errData.error || "Failed to save zone.");
      }
    } catch (err) {
      setZoneError("Error communicating with database.");
    } finally {
      setZoneSubmitting(false);
    }
  };

  const handleDeleteZone = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete zone "${name}"? Items placed here may need to be reallocated.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/zones/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (res.ok) {
        await fetchData();
        showToast(`Zone "${name}" deleted successfully.`);
      } else {
        const errData = await res.json();
        showToast(errData.error || "Failed to delete zone.", "error");
      }
    } catch (err) {
      showToast("Error communicating with database.", "error");
    }
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryForm.name) {
      setCategoryError("Category name is required.");
      return;
    }

    setCategorySubmitting(true);
    setCategoryError('');

    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: categoryForm.name,
          description: categoryForm.description,
          color: categoryForm.color
        })
      });

      if (res.ok) {
        await fetchData();
        setCategoryForm({
          name: '',
          description: '',
          color: 'emerald'
        });
        showToast(`Category "${categoryForm.name}" created successfully!`);
        if (typeof confetti === 'function') {
          confetti({ particleCount: 20, spread: 40 });
        }
      } else {
        const errData = await res.json();
        setCategoryError(errData.error || "Failed to save category.");
      }
    } catch (err) {
      setCategoryError("Error communicating with database.");
    } finally {
      setCategorySubmitting(false);
    }
  };

  const handleDeleteCategory = async (id: string, name: string) => {