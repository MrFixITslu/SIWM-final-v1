import React, { useState, useEffect } from 'react';
import { ShieldCheck, Filter, RefreshCw, AlertCircle, CheckCircle2, Clock, User, Activity } from 'lucide-react';

interface AuditLog {
  id: string;
  warehouseId: string;
  action: string;
  category: 'SECURITY' | 'INVENTORY' | 'TRANSFER' | 'PROCUREMENT' | 'TENANT' | 'USER';
  details: string;
  operator: string;
  operatorId?: string;
  ipAddress?: string;
  status: 'SUCCESS' | 'FAILED' | 'WARNING';
  timestamp: string;
}

interface AuditLedgerViewProps {
  token: string | null;
  userRole: string;
}

export const AuditLedgerView: React.FC<AuditLedgerViewProps> = ({ token, userRole }) => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchLogs = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/audit-logs?limit=150', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.auditLogs || []);
      }
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [token]);

  const filteredLogs = logs.filter(log => {
    if (categoryFilter !== 'ALL' && log.category !== categoryFilter) return false;
    if (statusFilter !== 'ALL' && log.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        log.action.toLowerCase().includes(q) ||
        log.details.toLowerCase().includes(q) ||
        log.operator.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const getCategoryBadgeClass = (cat: string) => {
    switch (cat) {
      case 'SECURITY':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      case 'INVENTORY':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'TRANSFER':
        return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
      case 'PROCUREMENT':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'TENANT':
      case 'USER':
        return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  if (userRole !== 'admin' && userRole !== 'manager') {
    return (
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-8 text-center text-slate-400">
        <ShieldCheck className="h-10 w-10 text-slate-600 mx-auto mb-3" />
        <h4 className="text-base font-bold text-white mb-1">Access Restricted</h4>
        <p className="text-xs text-slate-400">
          Security and compliance audit trails are restricted to Administrators and Inventory Managers.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in" id="panel_audit_ledger">
      {/* Header with Search and Filters */}
      <div className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-2xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Activity className="h-5 w-5 text-indigo-400" />
            System & Operations Audit Ledger
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Immutable operational logs recording all security events, stock adjustments, procurement actions, and tenant changes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <input
              type="text"
              placeholder="Search action or details..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-bold"
          >
            <option value="ALL">All Categories</option>
            <option value="SECURITY">Security & Auth</option>
            <option value="INVENTORY">Inventory Movements</option>
            <option value="PROCUREMENT">Procurement & PO</option>
            <option value="TRANSFER">Inter-Warehouse</option>
            <option value="TENANT">Tenant & Setup</option>
            <option value="USER">User & Team</option>
          </select>

          <button
            onClick={fetchLogs}
            disabled={loading}
            className="p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl transition"
            title="Refresh logs"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse" id="tbl_audit_logs">
            <thead>
              <tr className="bg-slate-950/80 border-b border-slate-800/80 text-xs font-bold text-slate-400 uppercase tracking-widest">
                <th className="py-4 px-6">Timestamp UTC</th>
                <th className="py-4 px-6">Category</th>
                <th className="py-4 px-6">Action Event</th>
                <th className="py-4 px-6">Details / Payload</th>
                <th className="py-4 px-6">Operator</th>
                <th className="py-4 px-6 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50 text-xs">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    No audit records matching the specified filters.
                  </td>
                </tr>
              ) : (
                filteredLogs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-900/30 transition-colors">
                    <td className="py-3.5 px-6 font-mono text-slate-400 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                      })}
                    </td>
                    <td className="py-3.5 px-6">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border ${getCategoryBadgeClass(log.category)}`}>
                        {log.category}
                      </span>
                    </td>
                    <td className="py-3.5 px-6 font-mono font-bold text-slate-200">
                      {log.action}
                    </td>
                    <td className="py-3.5 px-6 text-slate-300 max-w-md break-words">
                      {log.details}
                    </td>
                    <td className="py-3.5 px-6 text-slate-400 whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        <User className="h-3 w-3 text-slate-500" />
                        {log.operator}
                      </span>
                    </td>
                    <td className="py-3.5 px-6 text-center whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        log.status === 'SUCCESS' 
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}>
                        {log.status === 'SUCCESS' ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                        {log.status}
                      </span>
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
