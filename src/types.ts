export interface WarehouseLocation {
  zone: string;  // e.g. "Zone A", "Zone B", "Zone C", "Cold Storage"
  aisle: string; // e.g. "Aisle 01", "Aisle 02"
  shelf: string; // e.g. "Level 1", "Level 2", "Level 3"
  bin: string;   // e.g. "Bin 05", "Bin 12"
}

export interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  quantity: number;
  unit: string; // "pcs", "boxes", "pallets", "kg", "liters"
  price: number; // Unit Cost in USD
  warehouseLocation: WarehouseLocation;
  supplierId: string;
  minThreshold: number; // For low stock alerts
  lastUpdated: string; // ISO Date String
  notes?: string;
  isArchived?: boolean;
  batchNumber?: string;
  expiryDate?: string;
}

export interface Category {
  id: string;
  name: string;
  description: string;
  color: string; // Tailwind color name e.g. "emerald", "blue", "amber"
}

export interface WarehouseZone {
  id: string;
  name: string;
  description: string;
  maxCapacity: number; // e.g. Max pallets or items
  color: string;
}

export type TransactionType = 'INBOUND' | 'OUTBOUND' | 'TRANSFER_IN' | 'TRANSFER_OUT';

export interface StockTransaction {
  id: string;
  itemId: string;
  itemName: string;
  sku: string;
  type: TransactionType;
  quantity: number;
  reason: string; // e.g. "Purchase Order Received", "Customer Shipment", "Inventory Audit", "Damaged Goods", "Inter-Warehouse Transfer"
  timestamp: string;
  operator: string;
  batchNumber?: string;
  sourceWarehouseId?: string;
  destWarehouseId?: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
}

export type PurchaseOrderStatus = 'DRAFT' | 'ORDERED' | 'IN_TRANSIT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';

export interface PurchaseOrderItem {
  itemId?: string;
  sku: string;
  name: string;
  quantity: number;
  quantityReceived?: number;
  unitPrice: number;
  category?: string;
  zone?: string;
  batchNumber?: string;
  expiryDate?: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId?: string;
  supplierName?: string;
  status: PurchaseOrderStatus;
  items: PurchaseOrderItem[];
  totalAmount: number;
  expectedDelivery?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StockTransferPayload {
  itemId: string;
  destWarehouseId: string;
  quantity: number;
  reason?: string;
  notes?: string;
  batchNumber?: string;
}

export interface ZoneCapacity {
  zoneId: string;
  zoneName: string;
  maxCapacity: number;
  currentOccupancy: number;
  occupancyPercentage: number;
  isOverCapacity: boolean;
  itemCount: number;
}

export type AuditCategory = 'SECURITY' | 'INVENTORY' | 'TENANT' | 'USER' | 'TRANSFER' | 'PROCUREMENT';

export interface SystemAuditLog {
  id: string;
  warehouseId: string;
  action: string;
  category: AuditCategory;
  details: string;
  operator: string;
  operatorId?: string;
  ipAddress?: string;
  status: 'SUCCESS' | 'WARNING' | 'FAILED';
  timestamp: string;
}

export interface PersonnelDispatchRecord {
  id: string;
  itemId: string;
  itemName: string;
  sku: string;
  quantity: number;
  recipientName: string;
  department?: string;
  badgeNumber?: string;
  projectCode?: string;
  operator: string;
  timestamp: string;
  notes?: string;
}

