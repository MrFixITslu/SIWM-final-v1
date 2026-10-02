import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRight, CheckCircle2, Clock3, Container, MapPin,
  PackageCheck, RefreshCw, Search, Ship, Truck, XCircle,
} from 'lucide-react';

type ShipmentStatus = 'PLANNED' | 'BOOKED' | 'IN_TRANSIT' | 'CUSTOMS' | 'RECEIVED' | 'DELIVERED' | 'EXCEPTION' | 'CANCELLED';
type TrackingStatus = 'LABEL_CREATED' | 'PICKED_UP' | 'IN_TRANSIT' | 'AT_FORWARDER' | 'CUSTOMS' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'EXCEPTION' | 'RETURNED' | 'UNKNOWN';

interface Shipment {
  id: string; reference: string; mode: string; status: ShipmentStatus; carrier?: string;
  trackingNumber?: string; origin?: string; destination?: string; estimatedArrivalAt?: string;
  latestLocation?: string; latestTrackingStatus?: TrackingStatus; updatedAt: string;
}
interface TrackingPoint {
  id?: string; status: TrackingStatus; description: string; location?: string;
  occurredAt: string; estimatedDeliveryAt?: string; source: string;
}
interface ShipmentDetail { shipment: Shipment; tracking: TrackingPoint[]; trackingSummary: { status: TrackingStatus; latestDescription: string; latestLocation?: string; latestCheckpointAt?: string; estimatedDeliveryAt?: string; exception: boolean; delivered: boolean }; logisticsUnits: any[]; }

const dateTime = (value?: string) => value ? new Intl.DateTimeFormat(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }).format(new Date(value)) : 'Not available';
const dateOnly = (value?: string) => value ? new Intl.DateTimeFormat(undefined, { month:'short', day:'numeric', year:'numeric' }).format(new Date(value)) : 'Not available';
const statusLabel = (value?: string) => (value || 'UNKNOWN').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase());

function needsAttention(shipment: Shipment) {
  if (shipment.status === 'EXCEPTION' || shipment.latestTrackingStatus === 'EXCEPTION') return true;
  if (['DELIVERED','RECEIVED','CANCELLED'].includes(shipment.status) || !shipment.estimatedArrivalAt) return false;
  return Date.parse(shipment.estimatedArrivalAt) < Date.now();
}

function statusTone(shipment: Shipment) {
  if (needsAttention(shipment)) return 'border-rose-500/30 bg-rose-500/[0.06] text-rose-300';
  if (shipment.status === 'DELIVERED' || shipment.status === 'RECEIVED') return 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-300';
  if (shipment.status === 'CUSTOMS') return 'border-amber-500/25 bg-amber-500/[0.06] text-amber-300';
  return 'border-[#0A86FF]/25 bg-[#0A86FF]/[0.06] text-[#74d0ff]';
}

export function ShippingControlTower({ token }: { token: string }) {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ShipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [destination, setDestination] = useState('');
  const [creating, setCreating] = useState(false);
  const [carrierHint, setCarrierHint] = useState('');

  const request = async (url: string, options: RequestInit = {}) => {
    const response = await fetch(url, { ...options, headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}`, ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  };

  const loadShipments = async () => {
    setLoading(true); setError('');
    try {
      const data = await request('/api/v1/shipments?limit=250');
      setShipments(data.shipments || []);
    } catch (err: any) { setError(err.message || 'Unable to load shipments.'); }
    finally { setLoading(false); }
  };

  const loadDetail = async (id: string) => {
    setSelectedId(id); setDetailLoading(true); setError('');
    try { setDetail(await request(`/api/v1/shipments/${encodeURIComponent(id)}`)); }
    catch (err: any) { setError(err.message || 'Unable to load shipment.'); }
    finally { setDetailLoading(false); }
  };

  useEffect(() => { void loadShipments(); }, [token]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const value = trackingNumber.trim();
      if (value.length < 6) { setCarrierHint(''); return; }
      try {
        const data = await request('/api/v1/tracking/detect-carrier', { method:'POST', body:JSON.stringify({ trackingNumber:value }) });
        const top = data.candidates?.[0];
        setCarrierHint(top && top.carrier !== 'UNKNOWN' ? `${top.carrier} · ${top.confidence.toLowerCase()} confidence` : 'Carrier will be confirmed by the tracking provider');
      } catch { setCarrierHint(''); }
    }, 350);
    return () => clearTimeout(timer);
  }, [trackingNumber]);

  const quickTrack = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = trackingNumber.trim();
    if (!value) return;
    setCreating(true); setError('');
    try {
      const data = await request('/api/v1/shipments', {
        method:'POST',
        body:JSON.stringify({
          reference:`TRACK-${value.slice(-10).toUpperCase()}`,
          mode:'PARCEL', status:'BOOKED', trackingNumber:value,
          destination:destination.trim() || undefined,
        }),
      });
      setTrackingNumber(''); setDestination(''); setCarrierHint('');
      await loadShipments();
      await loadDetail(data.shipment.id);
    } catch (err: any) { setError(err.message || 'Unable to add shipment.'); }
    finally { setCreating(false); }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...shipments]
      .filter((shipment) => !q || [shipment.reference, shipment.trackingNumber, shipment.carrier, shipment.origin, shipment.destination, shipment.latestLocation].some((v) => v?.toLowerCase().includes(q)))
      .sort((a,b) => Number(needsAttention(b)) - Number(needsAttention(a)) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }, [shipments, query]);

  const active = shipments.filter((s) => !['DELIVERED','RECEIVED','CANCELLED'].includes(s.status)).length;
  const attention = shipments.filter(needsAttention).length;
  const customs = shipments.filter((s) => s.status === 'CUSTOMS' || s.latestTrackingStatus === 'CUSTOMS').length;
  const delivered = shipments.filter((s) => s.status === 'DELIVERED').length;

  return <div className="space-y-4">
    <section className="relative overflow-hidden rounded-[24px] border border-[#1a3854] bg-[#091728] p-5 sm:p-6 shadow-[0_22px_70px_rgba(0,0,0,.20)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_10%,rgba(10,134,255,.17),transparent_30%),radial-gradient(circle_at_98%_86%,rgba(20,184,166,.13),transparent_35%)] pointer-events-none" />
      <div className="relative grid xl:grid-cols-[minmax(0,1fr)_minmax(420px,.8fr)] gap-6 items-center">
        <div>
          <div className="text-[9px] font-black uppercase tracking-[0.2em] text-[#68e6d4]">Shipping control tower</div>
          <h3 className="mt-2 text-3xl sm:text-[38px] font-black tracking-[-0.04em] text-white leading-tight">Every shipment. One clear view.</h3>
          <p className="mt-2 text-sm text-slate-400 max-w-2xl">Paste a tracking number and SWIM keeps the carrier journey, ETA, customs stage and exceptions together with your warehouse operations.</p>
        </div>
        <form onSubmit={quickTrack} className="rounded-2xl border border-[#244560] bg-[#06101d]/80 p-3">
          <label className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">Track a shipment</label>
          <div className="mt-2 flex gap-2">
            <input aria-label="Tracking number" value={trackingNumber} onChange={(e)=>setTrackingNumber(e.target.value)} placeholder="FedEx, UPS, DHL or other tracking number" className="min-w-0 flex-1 rounded-xl border border-[#244560] bg-[#07121f] px-3 py-2.5 text-sm text-white outline-none focus:border-[#14B8A6]" />
            <button disabled={creating || !trackingNumber.trim()} className="rounded-xl bg-gradient-to-r from-[#0A86FF] to-[#14B8A6] px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-white disabled:opacity-40">{creating ? 'Adding…' : 'Track'}</button>
          </div>
          <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
            <input aria-label="Destination optional" value={destination} onChange={(e)=>setDestination(e.target.value)} placeholder="Destination (optional)" className="min-w-0 flex-1 rounded-lg border border-[#1a3854] bg-[#07121f] px-3 py-2 text-[10px] text-slate-300 outline-none focus:border-[#14B8A6]" />
            <span className="text-[9px] text-slate-600">{carrierHint || 'Carrier detection is advisory until provider confirmation.'}</span>
          </div>
        </form>
      </div>
    </section>

    {error && <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.08] px-4 py-3 text-xs text-rose-300 flex items-center gap-2"><XCircle className="h-4 w-4" />{error}</div>}

    <section className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      <Metric icon={Truck} label="Active shipments" value={active} note="Currently moving or processing" />
      <Metric icon={AlertTriangle} label="Needs attention" value={attention} note="Exceptions or overdue ETA" alert={attention > 0} />
      <Metric icon={Container} label="In customs" value={customs} note="Clearance-stage shipments" />
      <Metric icon={PackageCheck} label="Delivered" value={delivered} note="Completed carrier deliveries" success />
    </section>

    <section className="grid xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,.85fr)] gap-4 items-start">
      <div className="rounded-[22px] border border-[#1a3854] bg-[#091728] overflow-hidden">
        <div className="p-4 border-b border-[#18324b] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div><h4 className="text-sm font-bold text-white">Shipment watchlist</h4><p className="text-[9px] text-slate-600 mt-0.5">Exceptions and overdue shipments appear first</p></div>
          <div className="flex items-center gap-2">
            <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-600"/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search shipments" className="w-52 rounded-xl border border-[#1a3854] bg-[#07121f] pl-9 pr-3 py-2 text-[10px] text-slate-200 outline-none focus:border-[#0A86FF]"/></div>
            <button onClick={()=>void loadShipments()} className="p-2 rounded-xl border border-[#1a3854] bg-[#07121f] text-slate-500 hover:text-white" title="Refresh"><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`}/></button>
          </div>
        </div>
        <div className="divide-y divide-[#18324b]">
          {!loading && visible.length === 0 && <div className="p-10 text-center text-[10px] text-slate-600">No shipments yet. Paste a tracking number above to start.</div>}
          {visible.map((shipment) => <button key={shipment.id} onClick={()=>void loadDetail(shipment.id)} className={`w-full p-4 text-left hover:bg-white/[0.018] transition ${selectedId===shipment.id?'bg-[#0A86FF]/[0.05]':''}`}>
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 h-9 w-9 shrink-0 rounded-xl border flex items-center justify-center ${statusTone(shipment)}`}><Truck className="h-4 w-4"/></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-[11px] font-black text-white">{shipment.reference}</span><span className={`rounded-full border px-2 py-0.5 text-[8px] font-bold ${statusTone(shipment)}`}>{statusLabel(shipment.latestTrackingStatus || shipment.status)}</span></div>
                <div className="mt-1 text-[9px] text-slate-500 truncate">{shipment.carrier || 'Carrier pending'} {shipment.trackingNumber ? `· ${shipment.trackingNumber}` : ''}</div>
                <div className="mt-2 grid sm:grid-cols-3 gap-2 text-[9px]">
                  <span className="text-slate-600 flex items-center gap-1"><MapPin className="h-3 w-3"/>{shipment.latestLocation || shipment.origin || 'Location pending'}</span>
                  <span className="text-slate-600 flex items-center gap-1"><Clock3 className="h-3 w-3"/>ETA {dateOnly(shipment.estimatedArrivalAt)}</span>
                  <span className="text-slate-600 truncate">{shipment.destination || 'Destination not set'}</span>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-700 mt-2"/>
            </div>
          </button>)}
        </div>
      </div>

      <ShipmentInspector detail={detail} loading={detailLoading} />
    </section>
  </div>;
}

function Metric({ icon:Icon, label, value, note, alert=false, success=false }: any) {
  const tone = alert ? 'text-rose-300' : success ? 'text-emerald-300' : 'text-[#74d0ff]';
  return <div className="rounded-2xl border border-[#1a3854] bg-[#0a1727] p-4"><div className="flex items-center justify-between"><div className={`h-9 w-9 rounded-xl border border-white/10 bg-[#07121f] grid place-items-center ${tone}`}><Icon className="h-4 w-4"/></div><span className="text-[7px] font-black tracking-[0.16em] text-slate-700">LIVE</span></div><div className="mt-3 text-[8px] uppercase tracking-[0.13em] text-slate-600 font-bold">{label}</div><div className={`mt-1 text-2xl font-black ${alert?'text-rose-200':'text-white'}`}>{value}</div><div className="mt-1 text-[9px] text-slate-600">{note}</div></div>;
}

function ShipmentInspector({ detail, loading }: { detail: ShipmentDetail | null; loading: boolean }) {
  if (loading) return <div className="rounded-[22px] border border-[#1a3854] bg-[#091728] p-8 text-center text-xs text-slate-500">Loading shipment…</div>;
  if (!detail) return <div className="rounded-[22px] border border-[#1a3854] bg-[#091728] p-8"><Ship className="h-7 w-7 text-[#68e6d4]"/><h4 className="mt-4 text-sm font-bold text-white">Select a shipment</h4><p className="mt-1 text-[10px] leading-relaxed text-slate-600">Its current location, ETA, exception state and complete carrier timeline will appear here.</p></div>;
  const { shipment, trackingSummary, tracking, logisticsUnits } = detail;
  return <div className="rounded-[22px] border border-[#1a3854] bg-[#091728] overflow-hidden sticky top-24">
    <div className="p-5 border-b border-[#18324b] bg-[radial-gradient(circle_at_100%_0%,rgba(20,184,166,.11),transparent_38%)]">
      <div className="flex items-start justify-between gap-3"><div><div className="text-[8px] uppercase tracking-[0.15em] text-[#68e6d4] font-black">Shipment detail</div><h4 className="mt-1 text-lg font-black text-white">{shipment.reference}</h4><div className="text-[9px] text-slate-600">{shipment.carrier || 'Carrier pending'} {shipment.trackingNumber ? `· ${shipment.trackingNumber}` : ''}</div></div><span className={`rounded-full border px-2.5 py-1 text-[8px] font-bold ${statusTone(shipment)}`}>{statusLabel(trackingSummary.status || shipment.status)}</span></div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Info label="Current location" value={trackingSummary.latestLocation || shipment.latestLocation || 'Pending'} />
        <Info label="Estimated arrival" value={dateOnly(trackingSummary.estimatedDeliveryAt || shipment.estimatedArrivalAt)} />
        <Info label="Last carrier update" value={dateTime(trackingSummary.latestCheckpointAt)} />
        <Info label="Handling units" value={String(logisticsUnits.length)} />
      </div>
    </div>
    <div className="p-5 max-h-[520px] overflow-auto">
      <h5 className="text-[9px] uppercase tracking-[0.15em] text-slate-600 font-black mb-4">Tracking timeline</h5>
      {!tracking.length && <div className="rounded-xl border border-dashed border-[#244560] bg-[#07121f] p-4 text-[10px] text-slate-600">Tracking number is saved. SWIM is waiting for the first carrier-provider checkpoint.</div>}
      <div className="space-y-0">
        {[...tracking].reverse().map((point,index) => <div key={point.id || `${point.occurredAt}-${index}`} className="relative pl-7 pb-5 last:pb-0"><div className={`absolute left-0 top-0 h-4 w-4 rounded-full border-2 ${point.status==='EXCEPTION'?'border-rose-400 bg-rose-950':point.status==='DELIVERED'?'border-emerald-400 bg-emerald-950':'border-[#0A86FF] bg-[#07111f]'}`}/>{index < tracking.length-1 && <div className="absolute left-[7px] top-4 bottom-0 w-px bg-[#1a3854]"/>}<div className="flex items-center justify-between gap-3"><span className="text-[10px] font-bold text-slate-200">{statusLabel(point.status)}</span><span className="text-[8px] text-slate-700">{dateTime(point.occurredAt)}</span></div><p className="mt-1 text-[9px] text-slate-500 leading-relaxed">{point.description}</p>{point.location && <div className="mt-1 text-[8px] text-slate-700 flex items-center gap-1"><MapPin className="h-3 w-3"/>{point.location}</div>}</div>)}
      </div>
    </div>
  </div>;
}

function Info({ label, value }: { label:string; value:string }) { return <div className="rounded-xl border border-[#18324b] bg-[#07121f] p-3"><div className="text-[8px] uppercase tracking-[0.12em] text-slate-700 font-bold">{label}</div><div className="mt-1 text-[10px] font-semibold text-slate-300 truncate">{value}</div></div>; }