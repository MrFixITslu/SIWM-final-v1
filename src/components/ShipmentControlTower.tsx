import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Box,
  CheckCircle2,
  Clock3,
  Container,
  MapPin,
  PackageCheck,
  Plus,
  RefreshCw,
  Route,
  Search,
  Ship,
  Truck,
  X
} from 'lucide-react';

interface Shipment {
  id: string;
  reference: string;
  direction: 'INBOUND' | 'OUTBOUND' | 'TRANSFER' | 'RETURN';
  mode: 'AIR' | 'OCEAN' | 'GROUND' | 'COURIER' | 'OTHER';
  status: string;
  originCountry?: string;
  originLocation?: string;
  destinationCountry?: string;
  destinationLocation?: string;
  supplierId?: string;
  purchaseOrderId?: string;
  customerReference?: string;
  freightForwarder?: string;
  masterTrackingNumber?: string;
  carrierCode?: string;
  estimatedArrival?: string;
  actualArrival?: string;
  currency?: string;
  goodsValue?: number;
  freightCost?: number;
  insuranceCost?: number;
  notes?: string;
}

interface TrackingCheckpoint {
  id: string;
  trackingNumber: string;
  carrierCode: string;
  status: string;
  statusDetail?: string;
  location?: string;
  countryCode?: string;
  eventTime: string;
  source: string;
}

interface Props {
  token: string | null;
  userRole: string;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const statusOrder = [
  'PLANNED',
  'BOOKED',
  'PICKED_UP',
  'IN_TRANSIT',
  'AT_FORWARDER',
  'CONSOLIDATED',
  'AT_PORT',
  'CUSTOMS_PROCESSING',
  'CUSTOMS_CLEARED',
  'OUT_FOR_DELIVERY',
  'DELIVERED'
];

const statusLabel = (value: string) =>
  value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

const statusClass = (status: string) => {
  if (status === 'DELIVERED') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (status === 'EXCEPTION' || status === 'CUSTOMS_HOLD') return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
  if (status.includes('CUSTOMS') || status === 'AT_PORT') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (status === 'IN_TRANSIT' || status === 'OUT_FOR_DELIVERY') return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300';
  return 'border-slate-600/40 bg-slate-700/25 text-slate-300';
};

const formatDate = (value?: string) => {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const transportIcon = (mode: Shipment['mode']) => {
  if (mode === 'OCEAN') return Ship;
  if (mode === 'GROUND') return Truck;
  if (mode === 'COURIER') return PackageCheck;
  if (mode === 'AIR') return Route;
  return Container;
};

export const ShipmentControlTower: React.FC<Props> = ({ token, userRole, showToast }) => {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Shipment | null>(null);
  const [checkpoints, setCheckpoints] = useState<TrackingCheckpoint[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showTracking, setShowTracking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [trackingSubmitting, setTrackingSubmitting] = useState(false);
  const [createForm, setCreateForm] = useState({
    reference: '',
    direction: 'INBOUND',
    mode: 'COURIER',
    originCountry: 'US',
    originLocation: '',
    destinationCountry: 'LC',
    destinationLocation: '',
    freightForwarder: '',
    carrierCode: '',
    masterTrackingNumber: '',
    estimatedArrival: '',
    currency: 'USD',
    goodsValue: '',
    freightCost: '',
    insuranceCost: '',
    notes: ''
  });
  const [trackingForm, setTrackingForm] = useState({
    trackingNumber: '',
    carrierCode: ''
  });

  const canManage = ['admin', 'manager', 'operator'].includes(userRole);

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token || ''}`
  });

  const loadShipments = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/swim/shipments', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Unable to load shipments.');
      const data = await res.json();
      setShipments(data.shipments || []);
      if (selected) {
        const refreshed = (data.shipments || []).find((item: Shipment) => item.id === selected.id);
        if (refreshed) setSelected(refreshed);
      }
    } catch (err: any) {
      showToast(err.message || 'Unable to load shipments.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadTracking = async (shipment: Shipment) => {
    if (!token) return;
    setSelected(shipment);
    try {
      const res = await fetch(`/api/swim/shipments/${encodeURIComponent(shipment.id)}/tracking`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Unable to load tracking history.');
      const data = await res.json();
      setCheckpoints(data.checkpoints || []);
    } catch (err: any) {
      setCheckpoints([]);
      showToast(err.message || 'Unable to load tracking history.', 'error');
    }
  };

  useEffect(() => {
    loadShipments();
  }, [token]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shipments;
    return shipments.filter((shipment) =>
      [
        shipment.reference,
        shipment.masterTrackingNumber,
        shipment.carrierCode,
        shipment.originLocation,
        shipment.destinationLocation,
        shipment.freightForwarder,
        shipment.status
      ].some((value) => String(value || '').toLowerCase().includes(q))
    );
  }, [shipments, query]);

  const summary = useMemo(() => ({
    total: shipments.length,
    moving: shipments.filter((s) => ['PICKED_UP','IN_TRANSIT','AT_FORWARDER','CONSOLIDATED','AT_PORT','CUSTOMS_PROCESSING','OUT_FOR_DELIVERY'].includes(s.status)).length,
    customs: shipments.filter((s) => s.status.includes('CUSTOMS')).length,
    exceptions: shipments.filter((s) => ['EXCEPTION','CUSTOMS_HOLD'].includes(s.status)).length,
    delivered: shipments.filter((s) => s.status === 'DELIVERED').length
  }), [shipments]);

  const submitShipment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token || !canManage) return;
    setSubmitting(true);
    try {
      const payload = {
        ...createForm,
        carrierCode: createForm.carrierCode || undefined,
        masterTrackingNumber: createForm.masterTrackingNumber || undefined,
        estimatedArrival: createForm.estimatedArrival
          ? new Date(createForm.estimatedArrival).toISOString()
          : undefined,
        goodsValue: createForm.goodsValue ? Number(createForm.goodsValue) : undefined,
        freightCost: createForm.freightCost ? Number(createForm.freightCost) : undefined,
        insuranceCost: createForm.insuranceCost ? Number(createForm.insuranceCost) : undefined
      };
      const res = await fetch('/api/swim/shipments', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to create shipment.');
      setShowCreate(false);
      setCreateForm((current) => ({
        ...current,
        reference: '',
        originLocation: '',
        destinationLocation: '',
        freightForwarder: '',
        carrierCode: '',
        masterTrackingNumber: '',
        estimatedArrival: '',
        goodsValue: '',
        freightCost: '',
        insuranceCost: '',
        notes: ''
      }));
      showToast('Shipment created in SWIM.', 'success');
      await loadShipments();
      if (data.shipment) await loadTracking(data.shipment);
    } catch (err: any) {
      showToast(err.message || 'Unable to create shipment.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const registerTracking = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token || !selected || !canManage) return;
    setTrackingSubmitting(true);
    try {
      const res = await fetch(
        `/api/swim/shipments/${encodeURIComponent(selected.id)}/tracking/register`,
        {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            trackingNumber: trackingForm.trackingNumber,
            carrierCode: trackingForm.carrierCode || undefined,
            providerCode: 'AFTERSHIP'
          })
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to register tracking.');
      setShowTracking(false);
      setTrackingForm({ trackingNumber: '', carrierCode: '' });
      showToast('Carrier tracking connected.', 'success');
      await loadShipments();
      await loadTracking(data.shipment || selected);
    } catch (err: any) {
      showToast(err.message || 'Unable to register tracking.', 'error');
    } finally {
      setTrackingSubmitting(false);
    }
  };

  const refreshTracking = async () => {
    if (!token || !selected || !canManage) return;
    setTrackingSubmitting(true);
    try {
      const res = await fetch(
        `/api/swim/shipments/${encodeURIComponent(selected.id)}/tracking/refresh`,
        {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ providerCode: 'AFTERSHIP' })
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to refresh tracking.');
      showToast('Tracking refreshed.', 'success');
      await loadShipments();
      await loadTracking(data.shipment || selected);
    } catch (err: any) {
      showToast(err.message || 'Unable to refresh tracking.', 'error');
    } finally {
      setTrackingSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in" id="panel_swim_shipping_control_tower">
      <section className="relative overflow-hidden rounded-[24px] border border-[#1a3854] bg-[#091728] p-5 sm:p-6">
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_86%_16%,rgba(20,184,166,.17),transparent_28%),radial-gradient(circle_at_96%_80%,rgba(10,134,255,.14),transparent_32%)]" />
        <div className="relative flex flex-col xl:flex-row xl:items-center justify-between gap-5">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[0.19em] text-[#68e6d4]">Shipping control tower</div>
            <h3 className="mt-2 text-2xl sm:text-3xl font-black tracking-tight text-white">Every shipment. One operational view.</h3>
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-slate-400">
              Track inbound and outbound goods, freight-forwarder handoffs, customs stages, delivery ETAs and exceptions from one workspace.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={loadShipments} className="px-3.5 py-2.5 rounded-xl border border-[#1a3854] bg-[#07121f] text-slate-300 text-xs font-bold flex items-center gap-2 hover:border-[#2b5275]">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            {canManage && (
              <button onClick={() => setShowCreate(true)} className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#0A86FF] to-[#14B8A6] text-white text-xs font-black flex items-center gap-2">
                <Plus className="h-4 w-4" />
                New shipment
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Metric label="All shipments" value={summary.total} icon={Box} />
        <Metric label="Moving" value={summary.moving} icon={Truck} accent="cyan" />
        <Metric label="Customs" value={summary.customs} icon={Container} accent="amber" />
        <Metric label="Exceptions" value={summary.exceptions} icon={AlertTriangle} accent={summary.exceptions ? 'rose' : 'slate'} />
        <Metric label="Delivered" value={summary.delivered} icon={CheckCircle2} accent="emerald" />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,.65fr)] gap-4">
        <div className="rounded-[22px] border border-[#1a3854] bg-[#091728] overflow-hidden">
          <div className="p-4 border-b border-[#18324b] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-bold text-white">Shipment board</h4>
              <p className="text-[10px] text-slate-500 mt-0.5">Current route, carrier, ETA and exception state at a glance</p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-600" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tracking, reference, carrier..."
                className="w-full rounded-xl border border-[#244560] bg-[#07121f] pl-9 pr-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 outline-none"
              />
            </div>
          </div>

          <div className="divide-y divide-[#18324b]">
            {filtered.length === 0 ? (
              <div className="p-10 text-center">
                <Ship className="h-9 w-9 text-slate-700 mx-auto mb-3" />
                <p className="text-xs text-slate-500">No shipments match this workspace yet.</p>
              </div>
            ) : filtered.map((shipment) => {
              const Icon = transportIcon(shipment.mode);
              return (
                <button
                  key={shipment.id}
                  onClick={() => loadTracking(shipment)}
                  className={`w-full p-4 text-left hover:bg-white/[0.018] transition-colors ${selected?.id === shipment.id ? 'bg-[#0A86FF]/[0.04]' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-xl bg-[#07121f] border border-[#1a3854] flex items-center justify-center shrink-0">
                      <Icon className="h-4.5 w-4.5 text-[#74d0ff]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-black text-white">{shipment.reference}</span>
                        <span className={`px-2 py-0.5 rounded-full border text-[8px] font-black uppercase tracking-wider ${statusClass(shipment.status)}`}>
                          {statusLabel(shipment.status)}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-[9px]">
                        <div className="flex items-center gap-1.5 text-slate-500">
                          <MapPin className="h-3 w-3" />
                          <span className="truncate">{shipment.originLocation || shipment.originCountry || 'Origin pending'}</span>
                          <ArrowRight className="h-3 w-3 shrink-0" />
                          <span className="truncate">{shipment.destinationLocation || shipment.destinationCountry || 'Destination pending'}</span>
                        </div>
                        <div className="text-slate-500">
                          <span className="text-slate-600">Carrier:</span> <span className="text-slate-300 font-bold">{shipment.carrierCode || 'Not connected'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-500">
                          <Clock3 className="h-3 w-3" />
                          ETA <span className="text-slate-300 font-bold">{formatDate(shipment.estimatedArrival)}</span>
                        </div>
                      </div>
                      {shipment.masterTrackingNumber && (
                        <div className="mt-2 font-mono text-[9px] text-[#68e6d4] truncate">{shipment.masterTrackingNumber}</div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="rounded-[22px] border border-[#1a3854] bg-[#091728] overflow-hidden self-start xl:sticky xl:top-4">
          {!selected ? (
            <div className="p-8 text-center">
              <Route className="h-9 w-9 text-slate-700 mx-auto mb-3" />
              <h4 className="text-sm font-bold text-white">Select a shipment</h4>
              <p className="text-[10px] text-slate-500 mt-1">Tracking history and the current logistics timeline will appear here.</p>
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-[#18324b]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[8px] uppercase tracking-[0.16em] text-slate-600 font-black">Shipment detail</div>
                    <h4 className="mt-1 text-base font-black text-white">{selected.reference}</h4>
                    <p className="mt-1 text-[9px] text-slate-500">
                      {selected.mode} · {selected.direction}
                    </p>
                  </div>
                  <span className={`px-2 py-1 rounded-lg border text-[8px] font-black uppercase ${statusClass(selected.status)}`}>
                    {statusLabel(selected.status)}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Info label="Carrier" value={selected.carrierCode || 'Not connected'} />
                  <Info label="ETA" value={formatDate(selected.estimatedArrival)} />
                  <Info label="Tracking" value={selected.masterTrackingNumber || 'Pending'} mono />
                  <Info label="Forwarder" value={selected.freightForwarder || 'Not set'} />
                </div>

                {canManage && (
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => setShowTracking(true)} className="flex-1 px-3 py-2 rounded-xl border border-[#0A86FF]/30 bg-[#0A86FF]/10 text-[#74d0ff] text-[9px] font-black uppercase tracking-wider">
                      Connect tracking
                    </button>
                    <button
                      onClick={refreshTracking}
                      disabled={trackingSubmitting || !selected.masterTrackingNumber}
                      className="px-3 py-2 rounded-xl border border-[#1a3854] bg-[#07121f] text-slate-400 disabled:opacity-40"
                      title="Refresh carrier data"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${trackingSubmitting ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                )}
              </div>

              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h5 className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Tracking timeline</h5>
                  <span className="text-[8px] text-slate-600">{checkpoints.length} checkpoint{checkpoints.length === 1 ? '' : 's'}</span>
                </div>
                {checkpoints.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#244560] bg-[#07121f] p-5 text-center text-[9px] text-slate-600">
                    No carrier checkpoints recorded yet.
                  </div>
                ) : (
                  <div className="space-y-0 max-h-[460px] overflow-y-auto pr-1">
                    {checkpoints.map((cp, index) => (
                      <div key={cp.id} className="relative pl-6 pb-5">
                        {index < checkpoints.length - 1 && <div className="absolute left-[5px] top-3 bottom-0 w-px bg-[#244560]" />}
                        <div className={`absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full border-2 border-[#091728] ${cp.status === 'EXCEPTION' ? 'bg-rose-400' : cp.status === 'DELIVERED' ? 'bg-emerald-400' : 'bg-[#0A86FF]'}`} />
                        <div className="text-[10px] font-bold text-slate-200">{statusLabel(cp.status)}</div>
                        <div className="mt-0.5 text-[9px] text-slate-500">{cp.statusDetail || 'Carrier checkpoint'}</div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[8px] text-slate-600">
                          <span>{formatDate(cp.eventTime)}</span>
                          {cp.location && <span>{cp.location}</span>}
                          <span>{cp.carrierCode}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      </section>

      {showCreate && (
        <Modal title="Create shipment" onClose={() => !submitting && setShowCreate(false)}>
          <form onSubmit={submitShipment} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Shipment reference" required>
                <input required maxLength={120} value={createForm.reference} onChange={(e) => setCreateForm({ ...createForm, reference: e.target.value })} placeholder="e.g. OCT-IMPORT-0042" />
              </Field>
              <Field label="Direction">
                <select value={createForm.direction} onChange={(e) => setCreateForm({ ...createForm, direction: e.target.value })}>
                  <option value="INBOUND">Inbound</option>
                  <option value="OUTBOUND">Outbound</option>
                  <option value="TRANSFER">Warehouse transfer</option>
                  <option value="RETURN">Return</option>
                </select>
              </Field>
              <Field label="Transport mode">
                <select value={createForm.mode} onChange={(e) => setCreateForm({ ...createForm, mode: e.target.value })}>
                  <option value="COURIER">Courier</option>
                  <option value="AIR">Air freight</option>
                  <option value="OCEAN">Ocean freight</option>
                  <option value="GROUND">Ground</option>
                  <option value="OTHER">Other</option>
                </select>
              </Field>
              <Field label="ETA">
                <input type="datetime-local" value={createForm.estimatedArrival} onChange={(e) => setCreateForm({ ...createForm, estimatedArrival: e.target.value })} />
              </Field>
              <Field label="Origin country">
                <input maxLength={2} value={createForm.originCountry} onChange={(e) => setCreateForm({ ...createForm, originCountry: e.target.value.toUpperCase() })} placeholder="US" />
              </Field>
              <Field label="Origin location">
                <input maxLength={500} value={createForm.originLocation} onChange={(e) => setCreateForm({ ...createForm, originLocation: e.target.value })} placeholder="Miami, FL" />
              </Field>
              <Field label="Destination country">
                <input maxLength={2} value={createForm.destinationCountry} onChange={(e) => setCreateForm({ ...createForm, destinationCountry: e.target.value.toUpperCase() })} placeholder="LC" />
              </Field>
              <Field label="Destination location">
                <input maxLength={500} value={createForm.destinationLocation} onChange={(e) => setCreateForm({ ...createForm, destinationLocation: e.target.value })} placeholder="Castries, Saint Lucia" />
              </Field>
              <Field label="Freight forwarder">
                <input maxLength={200} value={createForm.freightForwarder} onChange={(e) => setCreateForm({ ...createForm, freightForwarder: e.target.value })} placeholder="Optional" />
              </Field>
              <Field label="Currency">
                <select value={createForm.currency} onChange={(e) => setCreateForm({ ...createForm, currency: e.target.value })}>
                  <option value="USD">USD</option>
                  <option value="XCD">XCD</option>
                  <option value="BBD">BBD</option>
                  <option value="JMD">JMD</option>
                  <option value="TTD">TTD</option>
                </select>
              </Field>
              <Field label="Goods value"><input type="number" min="0" step="0.01" value={createForm.goodsValue} onChange={(e) => setCreateForm({ ...createForm, goodsValue: e.target.value })} /></Field>
              <Field label="Freight"><input type="number" min="0" step="0.01" value={createForm.freightCost} onChange={(e) => setCreateForm({ ...createForm, freightCost: e.target.value })} /></Field>
              <Field label="Insurance"><input type="number" min="0" step="0.01" value={createForm.insuranceCost} onChange={(e) => setCreateForm({ ...createForm, insuranceCost: e.target.value })} /></Field>
              <Field label="Notes"><input maxLength={4000} value={createForm.notes} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })} /></Field>
            </div>
            <button disabled={submitting} className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#0A86FF] to-[#14B8A6] text-white text-xs font-black disabled:opacity-50">
              {submitting ? 'Creating shipment...' : 'Create shipment'}
            </button>
          </form>
        </Modal>
      )}

      {showTracking && selected && (
        <Modal title="Connect carrier tracking" onClose={() => !trackingSubmitting && setShowTracking(false)}>
          <form onSubmit={registerTracking} className="space-y-4">
            <div className="rounded-xl border border-[#1a3854] bg-[#07121f] p-3 text-[10px] text-slate-500">
              Enter the carrier tracking number. If the carrier is unknown, leave it blank and the configured tracking provider can attempt detection.
            </div>
            <Field label="Tracking number" required>
              <input required maxLength={80} autoComplete="off" value={trackingForm.trackingNumber} onChange={(e) => setTrackingForm({ ...trackingForm, trackingNumber: e.target.value })} placeholder="Enter or scan tracking number" />
            </Field>
            <Field label="Carrier code (optional)">
              <input maxLength={40} value={trackingForm.carrierCode} onChange={(e) => setTrackingForm({ ...trackingForm, carrierCode: e.target.value })} placeholder="e.g. fedex, ups, dhl" />
            </Field>
            <button disabled={trackingSubmitting} className="w-full py-2.5 rounded-xl bg-[#0A86FF] text-white text-xs font-black disabled:opacity-50">
              {trackingSubmitting ? 'Connecting carrier...' : 'Connect & retrieve tracking'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
};

function Metric({ label, value, icon: Icon, accent = 'blue' }: { label: string; value: number; icon: React.ComponentType<{ className?: string }>; accent?: string }) {
  const accents: Record<string, string> = {
    blue: 'text-[#74d0ff] bg-[#0A86FF]/10 border-[#0A86FF]/20',
    cyan: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/20',
    amber: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
    rose: 'text-rose-300 bg-rose-500/10 border-rose-500/20',
    emerald: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
    slate: 'text-slate-400 bg-slate-700/20 border-slate-600/20'
  };
  return (
    <div className="rounded-2xl border border-[#1a3854] bg-[#0a1727] p-4">
      <div className={`h-9 w-9 rounded-xl border flex items-center justify-center ${accents[accent] || accents.blue}`}><Icon className="h-4 w-4" /></div>
      <div className="mt-3 text-[8px] uppercase tracking-[0.14em] text-slate-600 font-black">{label}</div>
      <div className="mt-1 text-2xl font-black text-white">{value}</div>
    </div>
  );
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-[#18324b] bg-[#07121f] p-2.5 min-w-0">
      <div className="text-[7px] uppercase tracking-[0.14em] text-slate-600 font-black">{label}</div>
      <div className={`mt-1 text-[9px] text-slate-300 truncate ${mono ? 'font-mono' : 'font-semibold'}`}>{value}</div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block text-[9px] font-bold text-slate-400">
      <span className="block mb-1.5">{label}{required ? ' *' : ''}</span>
      <span className="[&>input]:w-full [&>input]:rounded-xl [&>input]:border [&>input]:border-[#244560] [&>input]:bg-[#07121f] [&>input]:px-3 [&>input]:py-2.5 [&>input]:text-xs [&>input]:text-slate-200 [&>select]:w-full [&>select]:rounded-xl [&>select]:border [&>select]:border-[#244560] [&>select]:bg-[#07121f] [&>select]:px-3 [&>select]:py-2.5 [&>select]:text-xs [&>select]:text-slate-200">
        {children}
      </span>
    </label>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[80] bg-[#020711]/80 backdrop-blur-sm p-4 flex items-center justify-center">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-[22px] border border-[#1a3854] bg-[#091728] shadow-2xl">
        <div className="sticky top-0 bg-[#091728]/95 backdrop-blur px-5 py-4 border-b border-[#18324b] flex items-center justify-between z-10">
          <h3 className="text-sm font-black text-white">{title}</h3>
          <button type="button" onClick={onClose} className="p-2 rounded-xl text-slate-500 hover:text-white hover:bg-white/[0.04]"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
