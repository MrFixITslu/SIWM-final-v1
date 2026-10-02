import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  PackageSearch,
  RefreshCw,
  ShieldAlert,
  Truck,
} from 'lucide-react';

type Severity = 'CRITICAL' | 'WARNING' | 'INFO';
type Category = 'SHIPPING' | 'CUSTOMS' | 'INVENTORY' | 'PROCUREMENT' | 'CONFIGURATION';

interface InboxItem {
  id: string;
  severity: Severity;
  category: Category;
  title: string;
  detail: string;
  entityType: 'shipment' | 'inventory_item' | 'purchase_order' | 'workspace';
  entityId: string;
  dueAt?: string;
  action?: string;
}
interface InboxResponse {
  generatedAt: string;
  counts: { critical:number; warning:number; info:number; total:number };
  items: InboxItem[];
}

const severityStyle: Record<Severity,string> = {
  CRITICAL:'border-rose-500/30 bg-rose-500/[0.07] text-rose-300',
  WARNING:'border-amber-500/30 bg-amber-500/[0.07] text-amber-300',
  INFO:'border-[#0A86FF]/25 bg-[#0A86FF]/[0.06] text-[#74d0ff]',
};
const categoryStyle: Record<Category,string> = {
  SHIPPING:'text-[#74d0ff]',
  CUSTOMS:'text-[#68e6d4]',
  INVENTORY:'text-amber-300',
  PROCUREMENT:'text-violet-300',
  CONFIGURATION:'text-slate-400',
};

export function OperationsInbox({
  token,
  onNavigate,
}: {
  token:string;
  onNavigate:(view:'shipping'|'customs'|'replenishment'|'suppliers')=>void;
}) {
  const [data,setData]=useState<InboxResponse|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [filter,setFilter]=useState<'ALL'|Severity>('ALL');

  const load=async()=>{
    setLoading(true); setError('');
    try{
      const response=await fetch('/api/v1/operations/inbox',{headers:{Authorization:`Bearer ${token}`}});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(payload.error||`Request failed (${response.status}).`);
      setData(payload as InboxResponse);
    }catch(err:any){
      setError(err?.message||'Unable to load operations inbox.');
    }finally{setLoading(false);}
  };

  useEffect(()=>{
    void load();
    const timer=window.setInterval(()=>{ if(document.visibilityState==='visible') void load(); },60_000);
    return()=>window.clearInterval(timer);
  },[token]);

  const items=useMemo(()=>{
    const rows=data?.items||[];
    return filter==='ALL'?rows:rows.filter((item)=>item.severity===filter);
  },[data,filter]);

  const destination=(item:InboxItem):'shipping'|'customs'|'replenishment'|'suppliers'=>{
    if(item.category==='SHIPPING') return 'shipping';
    if(item.category==='CUSTOMS') return 'customs';
    if(item.category==='PROCUREMENT') return 'suppliers';
    return 'replenishment';
  };

  return <div className="space-y-4">
    <section className="relative overflow-hidden rounded-[24px] border border-[#1a3854] bg-[#091728] p-5 sm:p-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_12%,rgba(239,68,68,.12),transparent_28%),radial-gradient(circle_at_96%_82%,rgba(10,134,255,.12),transparent_35%)] pointer-events-none"/>
      <div className="relative flex flex-col xl:flex-row xl:items-end justify-between gap-5">
        <div>
          <div className="text-[9px] font-black uppercase tracking-[0.2em] text-rose-300">Operations control tower</div>
          <h3 className="mt-2 text-3xl sm:text-[38px] font-black tracking-[-0.04em] text-white leading-tight">What needs your attention now?</h3>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">SWIM surfaces shipping exceptions, customs delays, stockout risk and overdue procurement before they become larger operational problems.</p>
        </div>
        <button onClick={()=>void load()} className="rounded-xl border border-[#1a3854] bg-[#07121f] px-3 py-2.5 text-[10px] font-bold text-slate-300 flex items-center gap-2 hover:border-[#2b5275]">
          <RefreshCw className={`h-3.5 w-3.5 ${loading?'animate-spin':''}`}/> Refresh
        </button>
      </div>
    </section>

    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      <Summary label="Critical" value={data?.counts.critical||0} icon={ShieldAlert} tone="text-rose-300"/>
      <Summary label="Warnings" value={data?.counts.warning||0} icon={AlertTriangle} tone="text-amber-300"/>
      <Summary label="Information" value={data?.counts.info||0} icon={CircleAlert} tone="text-[#74d0ff]"/>
      <Summary label="Open items" value={data?.counts.total||0} icon={PackageSearch} tone="text-[#68e6d4]"/>
    </div>

    {error&&<div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.07] p-3 text-[10px] text-rose-200 flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0"/>{error}</div>}

    <section className="rounded-[22px] border border-[#1a3854] bg-[#091728] overflow-hidden">
      <div className="p-4 border-b border-[#18324b] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-white">Attention queue</h4>
          <p className="mt-1 text-[9px] text-slate-600">{data?.generatedAt?`Updated ${new Date(data.generatedAt).toLocaleString()}`:'Waiting for live operational data'}</p>
        </div>
        <div className="flex gap-1.5">
          {(['ALL','CRITICAL','WARNING','INFO'] as const).map((value)=><button key={value} onClick={()=>setFilter(value)} className={`rounded-lg border px-2.5 py-1.5 text-[8px] font-black uppercase tracking-wider ${filter===value?'border-[#0A86FF]/35 bg-[#0A86FF]/12 text-[#74d0ff]':'border-[#1a3854] bg-[#07121f] text-slate-600'}`}>{value}</button>)}
        </div>
      </div>

      <div className="p-3 space-y-2">
        {items.map((item)=>{
          const target=destination(item);
          return <button key={item.id} onClick={()=>onNavigate(target)} className="w-full text-left rounded-2xl border border-[#18324b] bg-[#07121f] p-4 hover:border-[#2b5275] transition-colors group">
            <div className="flex items-start gap-3">
              <div className={`h-10 w-10 shrink-0 rounded-xl border grid place-items-center ${severityStyle[item.severity]}`}>
                {item.category==='SHIPPING'?<Truck className="h-4 w-4"/>:item.severity==='CRITICAL'?<ShieldAlert className="h-4 w-4"/>:<Clock3 className="h-4 w-4"/>}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-[8px] font-black uppercase tracking-[0.12em] ${categoryStyle[item.category]}`}>{item.category}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[7px] font-black uppercase tracking-wider ${severityStyle[item.severity]}`}>{item.severity}</span>
                </div>
                <div className="mt-1.5 text-[11px] font-bold text-slate-200">{item.title}</div>
                <div className="mt-1 text-[9px] leading-relaxed text-slate-600">{item.detail}</div>
                {item.dueAt&&<div className="mt-2 text-[8px] text-slate-700">Relevant date: {new Date(item.dueAt).toLocaleString()}</div>}
              </div>
              <div className="mt-1 flex items-center gap-1 text-[9px] font-bold text-[#74d0ff] opacity-70 group-hover:opacity-100">{item.action||'Review'}<ArrowRight className="h-3.5 w-3.5"/></div>
            </div>
          </button>;
        })}
        {!loading&&!items.length&&<div className="py-14 text-center">
          <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-400"/>
          <div className="mt-3 text-sm font-bold text-white">No items need attention in this view.</div>
          <div className="mt-1 text-[10px] text-slate-600">SWIM will surface new operational exceptions here.</div>
        </div>}
      </div>
    </section>
  </div>;
}

function Summary({label,value,icon:Icon,tone}:{label:string;value:number;icon:React.ComponentType<{className?:string}>;tone:string}){
  return <div className="rounded-2xl border border-[#1a3854] bg-[#0a1727] p-4"><Icon className={`h-4 w-4 ${tone}`}/><div className="mt-3 text-[8px] uppercase tracking-[0.14em] font-black text-slate-600">{label}</div><div className="mt-1 text-2xl font-black text-white">{value}</div></div>;
}
