import React, { useState, useEffect } from 'react';
import { Truck, Search, RefreshCw, User, Building, Hash, Calendar, ArrowUpRight } from 'lucide-react';

interface DispatchRecord {
  id: string;
  warehouseId: string;
  itemId?: string;
  itemName: string;
  sku: string;
  quantity: number;
  recipientName: string;
  department?: string;
  badgeNumber?: string;
  projectCode?: string;
  operator: string;
  notes?: string;
  timestamp: string;
}

interface PersonnelDispatchesViewProps {
  token: string | null;
}

export const PersonnelDispatchesView: React.FC<PersonnelDispatchesViewProps> = ({ token }) => {
  const [dispatches, setDispatches] = useState<DispatchRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchDispatches = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/dispatches', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDispatches(data.dispatches || []);
      }
    } catch (err) {
      console.error('Failed to load dispatches:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDispatches();
  }, [token]);

  const filteredDispatches = dispatches.filter(d => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      d.recipientName.toLowerCase().includes(q) ||
      d.itemName.toLowerCase().includes(q) ||
      d.sku.toLowerCase().includes(q) ||
      (d.department && d.department.toLowerCase().includes(q)) ||
      (d.badgeNumber && d.badgeNumber.toLowerCase().includes(q)) ||
      (d.projectCode && d.projectCode.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6 animate-fade-in" id="panel_personnel_dispatches">
      {/* Header and Filter */}
      <div className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-2xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Truck className="h-5 w-5 text-amber-400" />
            Personnel & Department Dispatches
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Historical chain-of-custody tracking outbound goods issued to specific field engineers, personnel, and departmental project units.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <input
              type="text"
              placeholder="Search recipient, SKU, department..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-64"
            />
          </div>

          <button
            onClick={fetchDispatches}
            disabled={loading}
            className="p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl transition"
            title="Refresh dispatches"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-amber-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Dispatches Table */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse" id="tbl_dispatches">
            <thead>
              <tr className="bg-slate-950/80 border-b border-slate-800/80 text-xs font-bold text-slate-400 uppercase tracking-widest">
                <th className="py-4 px-6">Timestamp UTC</th>
                <th className="py-4 px-6">Issued Recipient</th>
                <th className="py-4 px-6">Dept / Badge / Project</th>
                <th className="py-4 px-6">Product Item</th>
                <th className="py-4 px-6">SKU</th>
                <th className="py-4 px-6 text-right">Quantity</th>
                <th className="py-4 px-6">Dispatched By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50 text-xs">
              {filteredDispatches.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    <Truck className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    No outbound personnel dispatch records found.
                  </td>
                </tr>
              ) : (
                filteredDispatches.map(item => (
                  <tr key={item.id} className="hover:bg-slate-900/30 transition-colors">
                    <td className="py-3.5 px-6 font-mono text-slate-400 whitespace-nowrap">
                      {new Date(item.timestamp).toLocaleString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </td>
                    <td className="py-3.5 px-6 font-bold text-slate-100 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 text-amber-400" />
                        <span>{item.recipientName}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-6 text-slate-400">
                      <div className="flex flex-col gap-0.5 font-mono text-[11px]">
                        {item.department && <span>Dept: {item.department}</span>}
                        {item.badgeNumber && <span>Badge: #{item.badgeNumber}</span>}
                        {item.projectCode && <span>Project: {item.projectCode}</span>}
                        {!item.department && !item.badgeNumber && !item.projectCode && (
                          <span className="text-slate-600 italic">Direct Dispatch</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-6 font-semibold text-slate-200">
                      {item.itemName}
                    </td>
                    <td className="py-3.5 px-6 font-mono font-bold text-slate-400 whitespace-nowrap">
                      <span className="px-2 py-0.5 bg-slate-950 rounded border border-slate-850">
                        {item.sku}
                      </span>
                    </td>
                    <td className="py-3.5 px-6 text-right font-bold font-mono text-sm text-amber-400 whitespace-nowrap">
                      -{item.quantity}
                    </td>
                    <td className="py-3.5 px-6 text-slate-400 whitespace-nowrap">
                      {item.operator}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
