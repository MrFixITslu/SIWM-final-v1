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

export type TransactionType = 'INBOUND' | 'OUTBOUND';

export interface StockTransaction {
  id: string;
  itemId: string;
  itemName: string;
  sku: string;
  type: TransactionType;
  quantity: number;
  reason: string; // e.g. "Purchase Order Received", "Customer Shipment", "Inventory Audit", "Damaged Goods"
  timestamp: string;
  operator: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
}
