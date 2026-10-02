import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  PackageSearch,
  RefreshCw,
  Settings2,
  ShieldAlert,
  TrendingDown,
} from 'lucide-react';

type Risk = 'UNCONFIGURED' | 'CRITICAL' | 'AT_RISK' | 'WATCH' | 'HEALTHY' | 'NO_DEMAND';

interface Forecast {
  itemId: string;
  sku: string;
  name: string;
  supplierId?: string | null;
  onHand: number;
  inboundConfirmed: number;
  policyConfigured: boolean;
  risk: Risk;
  available?: number;
  averageDailyDemand?: number;
  totalLeadTimeDays?: number;
  stockoutInDays?: number;
  projectedStockAtReceipt?: number;
  reorderByDate?: string;
  recommendedOrderQuantity?: number;
  policy?: { id: string; name: string; scopeKey: string; demandWindowDays: number };
}

interface Supplier { id: string; name: string; }

const riskRank: Record<Risk, number> = {
  CRITICAL: 0,
  AT_RISK: 1,
  WATCH: 2,
  UNCONFIGURED: 3,
  HEALTHY: 4,
  NO_DEMAND: 5,
};

const riskStyle: Record<Risk, string> = {
  CRITICAL: 'border-rose-500/30 bg-rose-500/[0.08] text-rose-300',
  AT_RISK: 'border-orange-500/30 bg-orange-500/[0.08] text-orange-300',
  WATCH: 'border-amber-500/30 bg-amber-500/[0.08] text-amber-300',
  UNCONFIGURED: 'border-slate-500/30 bg-slate-500/[0.08] text-slate-400',
  HEALTHY: 'border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-300',
  NO_DEMAND: 'border-[#0A86FF]/25 bg-[#0A86FF]/[0.06] text-[#74d0ff]',
};

const riskLabel = (risk: Risk) => risk.replace('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
const daysLabel = (value?: number) => value == null ? '—' : value < 1 ? '< 1 day' : `${value.toFixed(value < 10 ? 1 : 0)} days`;
const dateLabel = (value?: string) => value ? new Date(value).toLocaleDateString() : '—';

export function ReplenishmentIntelligence({
  token,
  suppliers,
  canManage,
}: {
  token: string;
  suppliers: Supplier[];
  canManage: boolean;
}) {
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [generatedAt, setGeneratedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [showPolicy, setShowPolicy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [policyError, setPolicyError] = useState('');
  const [form, setForm] = useState({
    supplierId: '',
    name: 'Workspace default',
    supplierProcessingDays: '',
    originTransportDays: '',
    forwarderHandlingDays: '',
    internationalTransitDays: '',
    customsClearanceDays: '',
    localDeliveryDays: '',
    safetyStockDays: '',
    targetCoverageDays: '',
    demandWindowDays: '90',
  });

  const request = async (url: string, options: RequestInit = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}`, ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
    return payload;
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await request('/api/v1/replenishment/forecast');
      setForecasts(data.forecasts || []);
      setNotes(data.notes || []);
      setGeneratedAt(data.generatedAt || '');
    } catch (err: any) {
      setError(err?.message || 'Unable to load replenishment forecast.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [token]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...forecasts]
      .filter((row) => !q || [row.name, row.sku].some((value) => value?.toLowerCase().includes(q)))
      .sort((a,b) => riskRank[a.risk] - riskRank[b.risk] || (a.stockoutInDays ?? Infinity) - (b.stockoutInDays ?? Infinity));
  }, [forecasts, query]);

  const counts = useMemo(() => ({
    critical: forecasts.filter((row) => row.risk === 'CRITICAL').length,
    atRisk: forecasts.filter((row) => row.risk === 'AT_RISK').length,
    watch: forecasts.filter((row) => row.risk === 'WATCH').length,
    unconfigured: forecasts.filter((row) => row.risk === 'UNCONFIGURED').length,
  }), [forecasts]);

  const numeric = (value: string, label: string) => {
    if (value.trim() === '') throw new Error(`${label} is required.`);
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3650) throw new Error(`${label} must be a whole number between 0 and 3650.`);
    return parsed;
  };

  const savePolicy = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setPolicyError('');
    try {
      await request('/api/v1/replenishment/policies', {
        method:'POST',
        body:JSON.stringify({
          supplierId: form.supplierId || undefined,
          name: form.name.trim(),
          supplierProcessingDays: numeric(form.supplierProcessingDays, 'Supplier processing days'),
          originTransportDays: numeric(form.originTransportDays, 'Origin transport days'),
          forwarderHandlingDays: numeric(form.forwarderHandlingDays, 'Forwarder handling days'),
          internationalTransitDays: numeric(form.internationalTransitDays, 'International transit days'),
          customsClearanceDays: numeric(form.customsClearanceDays, 'Customs clearance days'),
          localDeliveryDays: numeric(form.localDeliveryDays, 'Local delivery days'),
          safetyStockDays: numeric(form.safetyStockDays, 'Safety stock days'),
          targetCoverageDays: numeric(form.targetCoverageDays, 'Target coverage days'),
          demandWindowDays: Math.max(1, numeric(form.demandWindowDays, 'Demand history window')),
        }),
      });
      setShowPolicy(false);
      await load();
    } catch (err: any) {
      setPolicyError(err?.message || 'Unable to save lead-time profile.');
    } finally {
      setSaving(false);
    }
  };

  const totalConfiguredLeadTime = [
    form.supplierProcessingDays, form.originTransportDays, form.forwarderHandlingDays,
    form.internationalTransitDays, form.customsClearanceDays, form.localDeliveryDays,
  ].reduce((sum, value) => sum + (Number(value) || 0), 0);

  return (
    <div className="space-y-4">
      <section className="relative overflow-hidden rounded-[24px] border border-[#1a3854] bg-[#091728] p-5 sm:p-6">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_12%,rgba(245,158,11,.14),transparent_30%),radial-gradient(circle_at_96%_88%,rgba(10,134,255,.12),transparent_35%)] pointer-events-none" />
        <div className="relative flex flex-col xl:flex-row xl:items-end justify-between gap-5">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-300">Inventory intelligence</div>
            <h3 className="mt-2 text-3xl sm:text-[38px] font-black tracking-[-0.04em] text-white leading-tight">Know what will run out before it happens.</h3>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              SWIM combines actual usage, confirmed inbound stock and your real supplier-to-warehouse lead time to calculate when to reorder and how much.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void load()} className="rounded-xl border border-[#1a3854] bg-[#07121f] px-3 py-2.5 text-[10px] font-bold text-slate-300 flex items-center gap-2 hover:border-[#2b5275]">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            {canManage && <button onClick={() => setShowPolicy((value) => !value)} className="rounded-xl border border-[#14B8A6]/30 bg-[#14B8A6]/10 px-3 py-2.5 text-[10px] font-bold text-[#68e6d4] flex items-center gap-2 hover:bg-[#14B8A6]/15">
              <Settings2 className="h-3.5 w-3.5" /> Lead-time profile
            </button>}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Summary label="Critical" value={counts.critical} icon={ShieldAlert} tone="text-rose-300" />
        <Summary label="At risk" value={counts.atRisk} icon={TrendingDown} tone="text-orange-300" />
        <Summary label="Watch" value={counts.watch} icon={CalendarClock} tone="text-amber-300" />
        <Summary label="Needs policy" value={counts.unconfigured} icon={Settings2} tone="text-slate-400" />
      </div>

      {showPolicy && canManage && (
        <form onSubmit={savePolicy} className="rounded-[22px] border border-[#14B8A6]/25 bg-[#091728] p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h4 className="text-sm font-bold text-white">Lead-time profile</h4>
              <p className="mt-1 text-[10px] text-slate-500">Create a workspace default or override it for a specific supplier. No values are assumed for you.</p>
            </div>
            <div className="text-right">
              <div className="text-[8px] uppercase tracking-[0.12em] text-slate-600">Configured transit chain</div>
              <div className="mt-1 text-lg font-black text-[#68e6d4]">{totalConfiguredLeadTime} days</div>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <PolicyField label="Scope">
              <select value={form.supplierId} onChange={(e) => setForm({...form, supplierId:e.target.value, name:e.target.value ? (suppliers.find((supplier) => supplier.id === e.target.value)?.name || 'Supplier route') : 'Workspace default'})} className="swim-input">
                <option value="">Workspace default</option>
                {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
              </select>
            </PolicyField>
            <PolicyField label="Profile name"><input value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} className="swim-input" required /></PolicyField>
            <PolicyNumber label="Supplier processing" value={form.supplierProcessingDays} set={(value)=>setForm({...form,supplierProcessingDays:value})} />
            <PolicyNumber label="Origin transport" value={form.originTransportDays} set={(value)=>setForm({...form,originTransportDays:value})} />
            <PolicyNumber label="Forwarder handling" value={form.forwarderHandlingDays} set={(value)=>setForm({...form,forwarderHandlingDays:value})} />
            <PolicyNumber label="International transit" value={form.internationalTransitDays} set={(value)=>setForm({...form,internationalTransitDays:value})} />
            <PolicyNumber label="Customs clearance" value={form.customsClearanceDays} set={(value)=>setForm({...form,customsClearanceDays:value})} />
            <PolicyNumber label="Local delivery" value={form.localDeliveryDays} set={(value)=>setForm({...form,localDeliveryDays:value})} />
            <PolicyNumber label="Safety stock days" value={form.safetyStockDays} set={(value)=>setForm({...form,safetyStockDays:value})} />
            <PolicyNumber label="Target coverage days" value={form.targetCoverageDays} set={(value)=>setForm({...form,targetCoverageDays:value})} />
            <PolicyNumber label="Demand history days" value={form.demandWindowDays} set={(value)=>setForm({...form,demandWindowDays:value})} min={1} />
          </div>
          {policyError && <div className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/[0.07] p-3 text-[10px] text-rose-200">{policyError}</div>}
          <div className="mt-4 flex justify-end">
            <button disabled={saving} className="rounded-xl bg-gradient-to-r from-[#14B8A6] to-[#0A86FF] px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save profile'}</button>
          </div>
        </form>
      )}

      {error && <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.07] p-3 text-[10px] text-rose-200 flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}

      <section className="rounded-[22px] border border-[#1a3854] bg-[#091728] overflow-hidden">
        <div className="p-4 border-b border-[#18324b] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-white">Stockout & reorder board</h4>
            <p className="mt-1 text-[9px] text-slate-600">{generatedAt ? `Generated ${new Date(generatedAt).toLocaleString()}` : 'Waiting for forecast data'}</p>
          </div>
          <input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search SKU or item…" className="swim-input sm:max-w-xs" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left">
            <thead className="bg-[#07121f] text-[8px] uppercase tracking-[0.12em] text-slate-600">
              <tr>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Risk</th>
                <th className="px-4 py-3 text-right">On hand</th>
                <th className="px-4 py-3 text-right">Inbound</th>
                <th className="px-4 py-3 text-right">Daily use</th>
                <th className="px-4 py-3 text-right">Stockout</th>
                <th className="px-4 py-3 text-right">Lead time</th>
                <th className="px-4 py-3">Reorder by</th>
                <th className="px-4 py-3 text-right">Suggested qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#18324b]">
              {visible.map((row) => (
                <tr key={row.itemId} className="hover:bg-white/[0.015]">
                  <td className="px-4 py-3">
                    <div className="text-[11px] font-bold text-slate-200">{row.name}</div>
                    <div className="mt-0.5 text-[9px] text-slate-600 font-mono">{row.sku}</div>
                  </td>
                  <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2 py-1 text-[8px] font-black uppercase tracking-wider ${riskStyle[row.risk]}`}>{riskLabel(row.risk)}</span></td>
                  <td className="px-4 py-3 text-right text-[10px] text-slate-300">{Number(row.onHand || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-[10px] text-slate-300">{Number(row.inboundConfirmed || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-[10px] text-slate-400">{row.averageDailyDemand == null ? '—' : row.averageDailyDemand.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-[10px] text-slate-400">{daysLabel(row.stockoutInDays)}</td>
                  <td className="px-4 py-3 text-right text-[10px] text-slate-400">{row.totalLeadTimeDays == null ? '—' : `${row.totalLeadTimeDays} days`}</td>
                  <td className="px-4 py-3 text-[10px] text-slate-400">{dateLabel(row.reorderByDate)}</td>
                  <td className="px-4 py-3 text-right text-[11px] font-black text-white">{row.recommendedOrderQuantity == null ? '—' : row.recommendedOrderQuantity.toLocaleString()}</td>
                </tr>
              ))}
              {!loading && !visible.length && <tr><td colSpan={9} className="px-5 py-12 text-center text-[10px] text-slate-600">No inventory items match this view.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {!!notes.length && <div className="rounded-xl border border-[#1a3854] bg-[#07121f] p-3 text-[9px] text-slate-600 space-y-1">
        {notes.map((note) => <div key={note}>• {note}</div>)}
      </div>}
    </div>
  );
}

function Summary({ label, value, icon: Icon, tone }: { label:string; value:number; icon:React.ComponentType<{className?:string}>; tone:string }) {
  return <div className="rounded-2xl border border-[#1a3854] bg-[#0a1727] p-4"><Icon className={`h-4 w-4 ${tone}`} /><div className="mt-3 text-[8px] uppercase tracking-[0.14em] font-black text-slate-600">{label}</div><div className="mt-1 text-2xl font-black text-white">{value}</div></div>;
}

function PolicyField({ label, children }: { label:string; children:React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[8px] font-bold uppercase tracking-[0.1em] text-slate-600">{label}</span>{children}</label>;
}

function PolicyNumber({ label, value, set, min = 0 }: { label:string; value:string; set:(value:string)=>void; min?:number }) {
  return <PolicyField label={label}><input type="number" min={min} max="3650" step="1" value={value} onChange={(e)=>set(e.target.value)} placeholder="Days" className="swim-input" required /></PolicyField>;
}
