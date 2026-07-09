import { Category, Supplier, WarehouseZone, InventoryItem, StockTransaction } from './types';

export const INITIAL_CATEGORIES: Category[] = [
  { id: 'cat-1', name: 'Electronics', description: 'Tech gadgets, computing components, and accessories', color: 'indigo' },
  { id: 'cat-2', name: 'Industrial Tools', description: 'Heavy machinery parts, power tools, and hardware', color: 'blue' },
  { id: 'cat-3', name: 'Perishable Goods', description: 'Fresh produce, climate-controlled organic foodstuff', color: 'emerald' },
  { id: 'cat-4', name: 'Safety Equipment', description: 'Personal protective equipment (PPE), helmets, and hazard gear', color: 'amber' },
  { id: 'cat-5', name: 'Packaging Materials', description: 'Corrugated boxes, bubble wrap, sealing adhesives, and pallets', color: 'slate' }
];

export const INITIAL_SUPPLIERS: Supplier[] = [
  { id: 'sup-1', name: 'Apex Electronics Corp', contactName: 'Sarah Jenkins', email: 'sjenkins@apex-corp.com', phone: '+1 (555) 019-2834', address: '482 Silicon Valley Dr, San Jose, CA' },
  { id: 'sup-2', name: 'Titan Tooling & Supply', contactName: 'Marcus Vance', email: 'mvance@titantools.com', phone: '+1 (555) 012-9922', address: '120 Industrial Pkwy, Cleveland, OH' },
  { id: 'sup-3', name: 'Everfresh Cold Chain Co.', contactName: 'Linus Chen', email: 'orders@everfreshcold.com', phone: '+1 (555) 017-4839', address: '900 Logistics Blvd, Seattle, WA' },
  { id: 'sup-4', name: 'Guardian Protective Gear', contactName: 'Elena Rostova', email: 'e.rostova@guardianprotective.com', phone: '+1 (555) 014-8855', address: '55 Shield Rd, Austin, TX' }
];

export const INITIAL_ZONES: WarehouseZone[] = [
  { id: 'Zone-A', name: 'Zone A (General High-Rack)', description: 'Dry goods, electronics, and heavy parts. Equipped with high-density stacking racks.', maxCapacity: 1000, color: 'indigo' },
  { id: 'Zone-B', name: 'Zone B (Bulk & Tooling)', description: 'Large machinery, oversized equipment, and raw industrial materials.', maxCapacity: 500, color: 'blue' },
  { id: 'Zone-C', name: 'Cold Storage (Zone C)', description: 'Deep freeze and refrigerated section (-18°C to 4°C) for sensitive organic cargo.', maxCapacity: 400, color: 'emerald' },
  { id: 'Zone-D', name: 'Zone D (Hazardous & Safety)', description: 'Highly secure, fire-suppressant-equipped space for safety gear and industrial sealants.', maxCapacity: 300, color: 'amber' }
];

export const INITIAL_ITEMS: InventoryItem[] = [
  {
    id: 'item-1',
    name: 'Logitech MX Master 3S Mouse',
    sku: 'EL-MX3-09',
    category: 'Electronics',
    quantity: 145,
    unit: 'pcs',
    price: 99.99,
    warehouseLocation: { zone: 'Zone-A', aisle: 'Aisle 01', shelf: 'Level 2', bin: 'Bin 04' },
    supplierId: 'sup-1',
    minThreshold: 30,
    lastUpdated: '2026-07-08T10:30:00Z',
    notes: 'Standard office issue accessory. High turn velocity.'
  },
  {
    id: 'item-2',
    name: 'Industrial Carbide Drill Bit Set (12pc)',
    sku: 'TL-CBD-12',
    category: 'Industrial Tools',
    quantity: 18,
    unit: 'boxes',
    price: 189.50,
    warehouseLocation: { zone: 'Zone-B', aisle: 'Aisle 03', shelf: 'Level 1', bin: 'Bin 15' },
    supplierId: 'sup-2',
    minThreshold: 20,
    lastUpdated: '2026-07-07T14:45:00Z',
    notes: 'Premium grade titanium-coated bit sets. Packaged in wooden cases.'
  },
  {
    id: 'item-3',
    name: 'Fresh Chilean Avocados (Hass)',
    sku: 'FR-AVO-CHL',
    category: 'Perishable Goods',
    quantity: 240,
    unit: 'boxes',
    price: 32.00,
    warehouseLocation: { zone: 'Cold Storage (Zone C)', aisle: 'Aisle 01', shelf: 'Level 3', bin: 'Bin 08' },
    supplierId: 'sup-3',
    minThreshold: 50,
    lastUpdated: '2026-07-09T08:15:00Z',
    notes: 'Keep strictly at 4°C. Expiry date: 2026-07-20.'
  },
  {
    id: 'item-4',
    name: 'Full-Face Safety Respirator Mask v2',
    sku: 'SF-RES-FF2',
    category: 'Safety Equipment',
    quantity: 12,
    unit: 'pcs',
    price: 74.99,
    warehouseLocation: { zone: 'Zone-D', aisle: 'Aisle 02', shelf: 'Level 2', bin: 'Bin 02' },
    supplierId: 'sup-4',
    minThreshold: 25,
    lastUpdated: '2026-07-06T11:20:00Z',
    notes: 'Active carbon filter mask. Critical safety stock level!'
  },
  {
    id: 'item-5',
    name: 'Heavy-Duty Reinforced Storage Pallets',
    sku: 'PK-PLT-HD',
    category: 'Packaging Materials',
    quantity: 85,
    unit: 'pallets',
    price: 45.00,
    warehouseLocation: { zone: 'Zone-B', aisle: 'Aisle 04', shelf: 'Level 1', bin: 'Bin 01' },
    supplierId: 'sup-2',
    minThreshold: 15,
    lastUpdated: '2026-07-05T09:00:00Z',
    notes: 'Standard 48x40 wooden pallets, static weight capacity 4,000 lbs.'
  },
  {
    id: 'item-6',
    name: 'High-Speed Cat8 Ethernet Cable (50ft)',
    sku: 'EL-CAT8-50',
    category: 'Electronics',
    quantity: 400,
    unit: 'pcs',
    price: 24.95,
    warehouseLocation: { zone: 'Zone-A', aisle: 'Aisle 02', shelf: 'Level 1', bin: 'Bin 11' },
    supplierId: 'sup-1',
    minThreshold: 100,
    lastUpdated: '2026-07-09T13:40:00Z',
    notes: 'Gold-plated connectors, double shielded high-speed cables.'
  },
  {
    id: 'item-7',
    name: 'Organic Milk Cartons (1 Gallon)',
    sku: 'FR-MLK-ORG',
    category: 'Perishable Goods',
    quantity: 35,
    unit: 'boxes',
    price: 18.50,
    warehouseLocation: { zone: 'Cold Storage (Zone C)', aisle: 'Aisle 02', shelf: 'Level 1', bin: 'Bin 05' },
    supplierId: 'sup-3',
    minThreshold: 40,
    lastUpdated: '2026-07-09T07:30:00Z',
    notes: 'Keep strictly at 2°C. Fast perishability. Expiry: 2026-07-16.'
  },
  {
    id: 'item-8',
    name: 'Welding Helmet Auto-Darkening',
    sku: 'SF-WLD-HLM',
    category: 'Safety Equipment',
    quantity: 34,
    unit: 'pcs',
    price: 112.00,
    warehouseLocation: { zone: 'Zone-D', aisle: 'Aisle 01', shelf: 'Level 3', bin: 'Bin 19' },
    supplierId: 'sup-4',
    minThreshold: 10,
    lastUpdated: '2026-07-08T16:10:00Z',
    notes: 'Solar powered lithium batteries. Shade range DIN 9-13.'
  }
];

export const INITIAL_TRANSACTIONS: StockTransaction[] = [
  { id: 'tx-1', itemId: 'item-1', itemName: 'Logitech MX Master 3S Mouse', sku: 'EL-MX3-09', type: 'INBOUND', quantity: 50, reason: 'Purchase Order Received', timestamp: '2026-07-08T10:30:00Z', operator: 'Alex Rivers (Floor Mgr)' },
  { id: 'tx-2', itemId: 'item-2', itemName: 'Industrial Carbide Drill Bit Set (12pc)', sku: 'TL-CBD-12', type: 'OUTBOUND', quantity: 5, reason: 'Customer Shipment', timestamp: '2026-07-07T14:45:00Z', operator: 'Alex Rivers (Floor Mgr)' },
  { id: 'tx-3', itemId: 'item-4', itemName: 'Full-Face Safety Respirator Mask v2', sku: 'SF-RES-FF2', type: 'OUTBOUND', quantity: 15, reason: 'Internal Site Dispensation', timestamp: '2026-07-06T11:20:00Z', operator: 'Jane Carter (Safety Director)' },
  { id: 'tx-4', itemId: 'item-6', itemName: 'High-Speed Cat8 Ethernet Cable (50ft)', sku: 'EL-CAT8-50', type: 'INBOUND', quantity: 150, reason: 'Supplier Bulk Intake', timestamp: '2026-07-09T13:40:00Z', operator: 'Alex Rivers (Floor Mgr)' },
  { id: 'tx-5', itemId: 'item-7', itemName: 'Organic Milk Cartons (1 Gallon)', sku: 'FR-MLK-ORG', type: 'OUTBOUND', quantity: 15, reason: 'Perishable Disposal (Damaged/Leaking)', timestamp: '2026-07-09T07:30:00Z', operator: 'Carlos Mendez (Cold-Chain Specialist)' },
  { id: 'tx-6', itemId: 'item-3', itemName: 'Fresh Chilean Avocados (Hass)', sku: 'FR-AVO-CHL', type: 'INBOUND', quantity: 100, reason: 'Import Shipment Lodgement', timestamp: '2026-07-09T08:15:00Z', operator: 'Carlos Mendez (Cold-Chain Specialist)' }
];
