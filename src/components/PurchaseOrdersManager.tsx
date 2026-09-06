import React, { useState, useEffect } from 'react';
import { ShoppingBag, Plus, CheckCircle2, Clock, AlertTriangle, ArrowDownLeft, X, PackageCheck, FileText } from 'lucide-react';
import confetti from 'canvas-confetti';

interface PurchaseOrderItem {
  itemId: string;
  name: string;
  sku: string;
  quantity: number;
  quantityReceived?: number;
  unitPrice: number;
  unit?: string;
}

interface PurchaseOrder {
  id: string;
  poNumber: string;
  warehouseId: string;
  supplierId: string;
  supplierName?: string;
  status: 'DRAFT' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
  items: PurchaseOrderItem[];
  totalAmount: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface PurchaseOrdersManagerProps {
  token: string | null;
  userRole: string;
  suppliers: any[];
  items: any[];
  onRefreshData: () => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const PurchaseOrdersManager: React.FC<PurchaseOrdersManagerProps> = ({
  token,
  userRole,
  suppliers,
  items,
  onRefreshData,
  showToast
}) => {
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);

  // Staged / Partial Receiving Modal
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [receivedInputs, setReceivedInputs] = useState<Record<string, number>>({});
  const [receivingSubmitting, setReceivingSubmitting] = useState(false);
  const [receiveError, setReceiveError] = useState('');

  const fetchPurchaseOrders = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/purchase-orders', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPurchaseOrders(data.purchaseOrders || []);
      }
    } catch (err) {
      console.error('Failed to fetch purchase orders:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPurchaseOrders();
  }, [token]);

  const openReceiveModal = (po: PurchaseOrder) => {
    setSelectedPO(po);
    const initialInputs: Record<string, number> = {};
    po.items.forEach(item => {
      const received = item.quantityReceived || 0;
      const remaining = Math.max(0, item.quantity - received);
      initialInputs[item.itemId] = remaining; // default to remaining
    });
    setReceivedInputs(initialInputs);
    setReceiveError('');
    setIsReceiveModalOpen(true);
  };

  const handleExecutePartialReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPO) return;

    setReceiveError('');
    setReceivingSubmitting(true);

    const receivedItems = Object.entries(receivedInputs)
      .filter(([_, qty]) => Number(qty) > 0)
      .map(([itemId, qty]) => ({
        itemId,
        quantityReceived: Number(qty)
      }));

    if (receivedItems.length === 0) {
      setReceiveError('Please enter at least one positive receiving quantity.');
      setReceivingSubmitting(false);
      return;
    }

    try {
      const res = await fetch(`/api/purchase-orders/${selectedPO.id}/receive`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ receivedItems })
      });

      const data = await res.json();
      if (res.ok) {
        showToast(`Staged intake recorded for PO #${selectedPO.poNumber}. New status: ${data.purchaseOrder.status}`, 'success');
        confetti({ particleCount: 40, spread: 50 });
        setIsReceiveModalOpen(false);
        setSelectedPO(null);
        await fetchPurchaseOrders();
        onRefreshData();
      } else {
        setReceiveError(data.error || 'Failed to process PO intake.');
      }
    } catch (err: any) {
      setReceiveError('Network error executing PO receipt.');
    } finally {
      setReceivingSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'RECEIVED':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'PARTIALLY_RECEIVED':
        return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
      case 'ORDERED':
        return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
      case 'DRAFT':
        return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
      case 'CANCELLED':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  return (
    <div className="space-y-6" id="panel_purchase_orders_manager">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-indigo-400" />
            Purchase Orders & Staged Receipts
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Track procurement purchase orders with multi-stage receiving, fractional deliveries, and automated stock intake.
          </p>
        </div>
      </div>

      {purchaseOrders.length === 0 ? (
        <div className="p-8 bg-slate-900/40 border border-slate-800/80 rounded-2xl text-center text-slate-500">
          <ShoppingBag className="h-10 w-10 mx-auto mb-2 opacity-30" />
          No purchase orders logged yet. Use the Auto-Reorder Planner above to generate restock orders.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {purchaseOrders.map(po => {
            const supplier = suppliers.find(s => s.id === po.supplierId);
            const totalOrderedQty = po.items.reduce((sum, i) => sum + i.quantity, 0);
            const totalReceivedQty = po.items.reduce((sum, i) => sum + (i.quantityReceived || 0), 0);
            const percentReceived = totalOrderedQty > 0 ? Math.round((totalReceivedQty / totalOrderedQty) * 100) : 0;
            const canReceive = po.status !== 'RECEIVED' && po.status !== 'CANCELLED';

            return (
              <div key={po.id} className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-2xl space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-sm text-indigo-400 bg-indigo-500/10 px-2.5 py-1 rounded-lg border border-indigo-500/20">
                      PO #{po.poNumber}
                    </span>
                    <div>
                      <h4 className="text-sm font-bold text-white">{supplier?.name || po.supplierName || po.supplierId}</h4>
                      <span className="text-xs text-slate-400">
                        Logged on {new Date(po.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider border ${getStatusBadge(po.status)}`}>
                      {po.status.replace('_', ' ')}
                    </span>

                    {canReceive && userRole !== 'viewer' && (
                      <button
                        onClick={() => openReceiveModal(po)}
                        className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow transition flex items-center gap-1.5"
                      >
                        <PackageCheck className="h-3.5 w-3.5" />
                        Receive Staged Stock
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                    <span>Intake Progress: <strong>{totalReceivedQty}</strong> of <strong>{totalOrderedQty}</strong> units</span>
                    <span className="font-bold text-slate-200">{percentReceived}%</span>
                  </div>
                  <div className="w-full bg-slate-950 rounded-full h-2 border border-slate-800 overflow-hidden">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        percentReceived === 100 ? 'bg-emerald-500' : 'bg-indigo-500'
                      }`}
                      style={{ width: `${Math.min(percentReceived, 100)}%` }}
                    />
                  </div>
                </div>

                {/* Items List */}
                <div className="space-y-2">
                  {po.items.map(item => {
                    const received = item.quantityReceived || 0;
                    const remaining = Math.max(0, item.quantity - received);

                    return (
                      <div key={item.itemId} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl bg-slate-950/40 border border-slate-800/60 text-xs gap-2">
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono font-bold text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
                            {item.sku}
                          </span>
                          <span className="font-semibold text-slate-200">{item.name}</span>
                        </div>

                        <div className="flex items-center gap-4 text-slate-400 font-mono">
                          <span>Ordered: <strong className="text-slate-200">{item.quantity}</strong></span>
                          <span>Received: <strong className="text-emerald-400">{received}</strong></span>
                          <span>Remaining: <strong className={remaining > 0 ? 'text-amber-400' : 'text-slate-500'}>{remaining}</strong></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Staged Receiving Modal */}
      {isReceiveModalOpen && selectedPO && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative animate-scale-up text-slate-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <PackageCheck className="h-5 w-5 text-emerald-400" />
                Intake Receiving for PO #{selectedPO.poNumber}
              </h3>
              <button
                onClick={() => setIsReceiveModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400 mb-4">
              Specify the physical units received in this shipment batch. Stock balances in active inventory will be updated immediately upon confirmation.
            </p>

            {receiveError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 mb-4 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{receiveError}</span>
              </div>
            )}

            <form onSubmit={handleExecutePartialReceive} className="space-y-4">
              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {selectedPO.items.map(item => {
                  const receivedSoFar = item.quantityReceived || 0;
                  const remaining = Math.max(0, item.quantity - receivedSoFar);

                  return (
                    <div key={item.itemId} className="p-3 bg-slate-950/60 border border-slate-850 rounded-xl space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-white">{item.name}</span>
                        <span className="font-mono text-slate-400">{item.sku}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px] text-slate-400">
                        <span>Ordered: {item.quantity} | Received so far: {receivedSoFar}</span>
                        <span className="text-amber-400 font-semibold">Remaining: {remaining}</span>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <label className="text-xs font-semibold text-slate-300">Intake this batch:</label>
                        <input
                          type="number"
                          min="0"
                          max={remaining}
                          value={receivedInputs[item.itemId] ?? 0}
                          onChange={(e) => {
                            const val = Math.max(0, parseInt(e.target.value) || 0);
                            setReceivedInputs(prev => ({ ...prev, [item.itemId]: val }));
                          }}
                          className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-emerald-400 focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-slate-800 pt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsReceiveModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-slate-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={receivingSubmitting}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-600/20 transition flex items-center gap-1.5"
                >
                  <ArrowDownLeft className="h-4 w-4" />
                  {receivingSubmitting ? 'Recording Intake...' : 'Confirm Stock Intake'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
