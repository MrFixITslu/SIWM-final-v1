import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Edit3,
  Mail,
  MapPin,
  PackageOpen,
  Phone,
  Plus,
  Ship,
  Truck,
  XCircle,
} from 'lucide-react';

type Mode = 'PARCEL' | 'AIR' | 'OCEAN' | 'GROUND' | 'COURIER' | 'INTER_ISLAND';

interface Forwarder {
  id:string;
  name:string;
  countryCode:string;
  facilityCode?:string;
  address?:string;
  contactName?:string;
  email?:string;
  phone?:string;
  accountReference?:string;
  receivingInstructions?:string;
  serviceModes:Mode[];
  active:boolean;
}

const MODES:Mode[]=['PARCEL','AIR','OCEAN','GROUND','COURIER','INTER_ISLAND'];

const blank = () => ({
  id:'',
  name:'',
  countryCode:'US',
  facilityCode:'',
  address:'',
  contactName:'',
  email:'',
  phone:'',
  accountReference:'',
  receivingInstructions:'',
  serviceModes:[] as Mode[],
  active:true,
});

export function FreightForwarders({
  token,
  canManage,
}:{
  token:string;
  canManage:boolean;
}) {
  const [forwarders,setForwarders]=useState<Forwarder[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [form,setForm]=useState(blank());
  const [editing,setEditing]=useState(false);
  const [showForm,setShowForm]=useState(false);
  const [saving,setSaving]=useState(false);
  const [query,setQuery]=useState('');

  const request=async(url:string,options:RequestInit={})=>{
    const response=await fetch(url,{
      ...options,
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,...(options.headers||{})},
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(payload.error||`Request failed (${response.status}).`);
    return payload;
  };

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const data=await request('/api/v1/freight-forwarders');
      setForwarders(data.forwarders||[]);
    }catch(err:any){setError(err?.message||'Unable to load freight forwarders.');}
    finally{setLoading(false);}
  };

  useEffect(()=>{void load();},[token]);

  const visible=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return forwarders.filter((forwarder)=>!q||[
      forwarder.name,forwarder.countryCode,forwarder.facilityCode,forwarder.address,forwarder.contactName,
    ].some((value)=>value?.toLowerCase().includes(q)));
  },[forwarders,query]);

  const edit=(forwarder:Forwarder)=>{
    setForm({
      ...blank(),
      ...forwarder,
      serviceModes:[...(forwarder.serviceModes||[])],
      accountReference:forwarder.accountReference||'',
    });
    setEditing(true);
    setShowForm(true);
  };

  const save=async(event:React.FormEvent)=>{
    event.preventDefault();
    setSaving(true);setError('');
    try{
      const body={
        name:form.name.trim(),
        countryCode:form.countryCode.trim().toUpperCase(),
        facilityCode:form.facilityCode.trim()||undefined,
        address:form.address.trim()||undefined,
        contactName:form.contactName.trim()||undefined,
        email:form.email.trim()||undefined,
        phone:form.phone.trim()||undefined,
        accountReference:form.accountReference.trim()||undefined,
        receivingInstructions:form.receivingInstructions.trim()||undefined,
        serviceModes:form.serviceModes,
        active:form.active,
      };
      await request(editing?`/api/v1/freight-forwarders/${encodeURIComponent(form.id)}`:'/api/v1/freight-forwarders',{
        method:editing?'PUT':'POST',
        body:JSON.stringify(body),
      });
      setShowForm(false);setEditing(false);setForm(blank());
      await load();
    }catch(err:any){setError(err?.message||'Unable to save freight forwarder.');}
    finally{setSaving(false);}
  };

  const toggleMode=(mode:Mode)=>{
    setForm({...form,serviceModes:form.serviceModes.includes(mode)
      ?form.serviceModes.filter((item)=>item!==mode)
      :[...form.serviceModes,mode]});
  };

  return <div className="space-y-4">
    <section className="relative overflow-hidden rounded-[24px] border border-[#1a3854] bg-[#091728] p-5 sm:p-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_12%,rgba(20,184,166,.16),transparent_30%),radial-gradient(circle_at_98%_82%,rgba(10,134,255,.11),transparent_35%)] pointer-events-none"/>
      <div className="relative flex flex-col xl:flex-row xl:items-end justify-between gap-5">
        <div>
          <div className="text-[9px] font-black uppercase tracking-[0.2em] text-[#68e6d4]">Logistics partner network</div>
          <h3 className="mt-2 text-3xl sm:text-[38px] font-black tracking-[-0.04em] text-white leading-tight">Freight forwarders</h3>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">Manage forwarding facilities once, then reuse them across supplier packages, consolidations and international shipment legs.</p>
        </div>
        {canManage&&<button onClick={()=>{setForm(blank());setEditing(false);setShowForm(true);}} className="rounded-xl bg-gradient-to-r from-[#14B8A6] to-[#0A86FF] px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-white flex items-center gap-2"><Plus className="h-4 w-4"/>Add forwarder</button>}
      </div>
    </section>

    {error&&<div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.07] px-4 py-3 text-[10px] text-rose-200 flex gap-2"><XCircle className="h-4 w-4 shrink-0"/>{error}</div>}

    {showForm&&canManage&&<form onSubmit={save} className="rounded-[22px] border border-[#14B8A6]/25 bg-[#091728] p-5">
      <div className="flex items-start justify-between gap-4">
        <div><h4 className="text-sm font-bold text-white">{editing?'Edit forwarder':'New freight forwarder'}</h4><p className="mt-1 text-[10px] text-slate-500">Contact, account and receiving details are encrypted per workspace.</p></div>
        <button type="button" onClick={()=>setShowForm(false)} className="text-slate-600 hover:text-white">×</button>
      </div>
      <div className="mt-4 grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        <Field label="Forwarder name"><input className="swim-input" value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} required/></Field>
        <Field label="Country code"><input className="swim-input uppercase" value={form.countryCode} onChange={(e)=>setForm({...form,countryCode:e.target.value})} maxLength={3} required/></Field>
        <Field label="Facility / member code"><input className="swim-input" value={form.facilityCode} onChange={(e)=>setForm({...form,facilityCode:e.target.value})}/></Field>
        <Field label="Contact name"><input className="swim-input" value={form.contactName} onChange={(e)=>setForm({...form,contactName:e.target.value})}/></Field>
        <Field label="Email"><input type="email" className="swim-input" value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})}/></Field>
        <Field label="Phone"><input className="swim-input" value={form.phone} onChange={(e)=>setForm({...form,phone:e.target.value})}/></Field>
        <Field label="Account reference"><input className="swim-input" value={form.accountReference} onChange={(e)=>setForm({...form,accountReference:e.target.value})} placeholder="Visible to managers/admins only"/></Field>
        <Field label="Address" wide><textarea className="swim-input min-h-20" value={form.address} onChange={(e)=>setForm({...form,address:e.target.value})}/></Field>
        <Field label="Receiving instructions" wide><textarea className="swim-input min-h-20" value={form.receivingInstructions} onChange={(e)=>setForm({...form,receivingInstructions:e.target.value})} placeholder="Suite code, labeling rules, receiving hours, package identification..."/></Field>
      </div>
      <div className="mt-4">
        <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-600 mb-2">Supported modes</div>
        <div className="flex flex-wrap gap-2">{MODES.map((mode)=><button type="button" key={mode} onClick={()=>toggleMode(mode)} className={`rounded-lg border px-2.5 py-1.5 text-[8px] font-black ${form.serviceModes.includes(mode)?'border-[#14B8A6]/35 bg-[#14B8A6]/10 text-[#68e6d4]':'border-[#1a3854] bg-[#07121f] text-slate-600'}`}>{mode.replace('_',' ')}</button>)}</div>
      </div>
      {editing&&<label className="mt-4 flex items-center gap-2 text-[10px] text-slate-400"><input type="checkbox" checked={form.active} onChange={(e)=>setForm({...form,active:e.target.checked})}/>Active partner</label>}
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={()=>setShowForm(false)} className="rounded-xl border border-[#1a3854] bg-[#07121f] px-4 py-2.5 text-[10px] font-bold text-slate-400">Cancel</button><button disabled={saving} className="rounded-xl bg-gradient-to-r from-[#14B8A6] to-[#0A86FF] px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-white disabled:opacity-50">{saving?'Saving…':'Save forwarder'}</button></div>
    </form>}

    <section className="rounded-[22px] border border-[#1a3854] bg-[#091728] overflow-hidden">
      <div className="p-4 border-b border-[#18324b] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div><h4 className="text-sm font-bold text-white">Forwarding network</h4><p className="mt-1 text-[9px] text-slate-600">{forwarders.length} active partner{forwarders.length===1?'':'s'}</p></div>
        <input className="swim-input sm:max-w-xs" value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search forwarders…"/>
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
        {visible.map((forwarder)=><article key={forwarder.id} className="rounded-2xl border border-[#18324b] bg-[#07121f] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="h-10 w-10 rounded-xl border border-[#14B8A6]/25 bg-[#14B8A6]/10 text-[#68e6d4] grid place-items-center"><Building2 className="h-4 w-4"/></div>
            <div className="flex items-center gap-2"><span className={`rounded-full border px-2 py-1 text-[8px] font-black ${forwarder.active?'border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-300':'border-slate-500/25 bg-slate-500/[0.07] text-slate-500'}`}>{forwarder.active?'ACTIVE':'INACTIVE'}</span>{canManage&&<button onClick={()=>edit(forwarder)} className="p-2 rounded-lg text-slate-600 hover:text-[#74d0ff] hover:bg-[#0A86FF]/10"><Edit3 className="h-3.5 w-3.5"/></button>}</div>
          </div>
          <h5 className="mt-3 text-[12px] font-black text-white">{forwarder.name}</h5>
          <div className="mt-1 text-[9px] text-slate-600">{[forwarder.facilityCode,forwarder.countryCode].filter(Boolean).join(' · ')}</div>
          {forwarder.address&&<div className="mt-3 flex gap-2 text-[9px] leading-relaxed text-slate-500"><MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5"/>{forwarder.address}</div>}
          <div className="mt-3 space-y-1.5">
            {forwarder.contactName&&<Row icon={CheckCircle2} value={forwarder.contactName}/>}
            {forwarder.email&&<Row icon={Mail} value={forwarder.email}/>}
            {forwarder.phone&&<Row icon={Phone} value={forwarder.phone}/>}
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">{(forwarder.serviceModes||[]).map((mode)=><span key={mode} className="rounded-md border border-[#1a3854] bg-[#091728] px-2 py-1 text-[7px] font-bold text-slate-500">{mode==='OCEAN'?<Ship className="inline h-3 w-3 mr-1"/>:mode==='GROUND'?<Truck className="inline h-3 w-3 mr-1"/>:<PackageOpen className="inline h-3 w-3 mr-1"/>}{mode.replace('_',' ')}</span>)}</div>
          {forwarder.receivingInstructions&&<div className="mt-4 rounded-xl border border-[#1a3854] bg-[#091728] p-3"><div className="text-[8px] uppercase tracking-[0.11em] font-black text-slate-700">Receiving notes</div><div className="mt-1 text-[9px] leading-relaxed text-slate-500">{forwarder.receivingInstructions}</div></div>}
        </article>)}
        {!loading&&!visible.length&&<div className="md:col-span-2 xl:col-span-3 py-12 text-center text-[10px] text-slate-600">No freight forwarders match this view.</div>}
      </div>
    </section>
  </div>;
}

function Field({label,children,wide=false}:{label:string;children:React.ReactNode;wide?:boolean}){return <label className={wide?'sm:col-span-2 xl:col-span-3':''}><span className="mb-1.5 block text-[8px] font-bold uppercase tracking-[0.1em] text-slate-600">{label}</span>{children}</label>;}
function Row({icon:Icon,value}:{icon:React.ComponentType<{className?:string}>;value:string}){return <div className="flex items-center gap-2 text-[9px] text-slate-600"><Icon className="h-3 w-3 text-slate-700"/><span className="truncate">{value}</span></div>;}
