import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  Landmark,
  PackageSearch,
  ReceiptText,
} from 'lucide-react';

interface Source {
  authority: string;
  sourceUrl: string;
  verifiedAt: string;
}
interface ChargeLine {
  ruleId: string;
  chargeCode: string;
  label: string;
  basisMinor: number;
  amountMinor: number;
  rateBps?: number;
  source: Source;
}
interface Estimate {
  currency: string;
  customsValueMinor: number;
  chargeLines: ChargeLine[];
  customsChargesMinor: number;
  ancillaryCostsMinor: number;
  estimatedLandedCostMinor: number;
}
interface EstimateResponse {
  estimateId?: string;
  estimate: Estimate;
  disclaimer: string;
}

const DESTINATIONS = [
  ['LC', 'Saint Lucia'],
  ['DM', 'Dominica'],
  ['GD', 'Grenada'],
  ['VC', 'St. Vincent & the Grenadines'],
  ['AG', 'Antigua & Barbuda'],
  ['BB', 'Barbados'],
  ['TT', 'Trinidad & Tobago'],
  ['JM', 'Jamaica'],
] as const;

const numberOrZero = (value: string) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const toMinor = (value: string) => {
  const amount = numberOrZero(value);
  const minor = Math.round(amount * 100);
  if (!Number.isSafeInteger(minor)) throw new Error('One or more monetary values are too large.');
  return minor;
};

const safeSourceUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
};

export function CustomsLandedCost({ token }: { token: string }) {
  const [destinationCountry, setDestinationCountry] = useState('LC');
  const [originCountry, setOriginCountry] = useState('US');
  const [hsCode, setHsCode] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [goodsValue, setGoodsValue] = useState('');
  const [freight, setFreight] = useState('');
  const [insurance, setInsurance] = useState('');
  const [brokerage, setBrokerage] = useState('');
  const [portFees, setPortFees] = useState('');
  const [localDelivery, setLocalDelivery] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [result, setResult] = useState<EstimateResponse | null>(null);
  const [error, setError] = useState('');
  const [guidance, setGuidance] = useState('');
  const [loading, setLoading] = useState(false);

  const formatter = useMemo(() => {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() || 'USD' });
    } catch {
      return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  }, [currency]);

  const money = (minor: number) => formatter.format((minor || 0) / 100);

  const calculate = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setGuidance('');
    setResult(null);
    try {
      if (!hsCode.trim()) throw new Error('Enter an HS code before calculating.');
      const response = await fetch('/api/v1/customs/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          save: false,
          destinationCountry,
          originCountry: originCountry.trim().toUpperCase() || undefined,
          hsCode: hsCode.trim(),
          currency: currency.trim().toUpperCase(),
          goodsValueMinor: toMinor(goodsValue),
          freightMinor: toMinor(freight),
          insuranceMinor: toMinor(insurance),
          brokerageMinor: toMinor(brokerage),
          portFeesMinor: toMinor(portFees),
          localDeliveryMinor: toMinor(localDelivery),
          valuationDate: new Date().toISOString().slice(0, 10),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload.code === 'CUSTOMS_RULES_UNAVAILABLE') setGuidance(payload.guidance || '');
        throw new Error(payload.error || `Calculation failed (${response.status}).`);
      }
      setResult(payload as EstimateResponse);
    } catch (err: any) {
      setError(err?.message || 'Unable to calculate the import estimate.');
    } finally {
      setLoading(false);
    }
  };

  const qty = Math.max(1, Math.trunc(numberOrZero(quantity) || 1));
  const perUnit = result ? Math.round(result.estimate.estimatedLandedCostMinor / qty) : 0;
  const destinationName = DESTINATIONS.find(([code]) => code === destinationCountry)?.[1] || destinationCountry;

  return (
    <div className="space-y-4">
      <section className="relative overflow-hidden rounded-[24px] border border-[#1a3854] bg-[#091728] p-5 sm:p-6 shadow-[0_22px_70px_rgba(0,0,0,.20)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_10%,rgba(20,184,166,.17),transparent_30%),radial-gradient(circle_at_98%_86%,rgba(10,134,255,.12),transparent_35%)] pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.2em] text-[#68e6d4]">
            <Landmark className="h-3.5 w-3.5" /> Caribbean trade intelligence
          </div>
          <h3 className="mt-2 text-3xl sm:text-[38px] font-black tracking-[-0.04em] text-white leading-tight">
            Duties & landed cost
          </h3>
          <p className="mt-2 text-sm text-slate-400 max-w-3xl">
            Estimate what imported goods may cost to clear and land in your warehouse using effective-dated rules with visible source provenance.
          </p>
        </div>
      </section>

      <div className="grid xl:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] gap-4 items-start">
        <form onSubmit={calculate} className="rounded-[22px] border border-[#1a3854] bg-[#091728] p-5 space-y-4">
          <div>
            <h4 className="text-sm font-bold text-white">Import details</h4>
            <p className="text-[10px] text-slate-500 mt-1">Use invoice values before the shipment is cleared to forecast the likely landed cost.</p>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Destination island">
              <select value={destinationCountry} onChange={(e) => setDestinationCountry(e.target.value)} className="swim-input">
                {DESTINATIONS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </Field>
            <Field label="Origin country code">
              <input value={originCountry} onChange={(e) => setOriginCountry(e.target.value)} maxLength={3} placeholder="US" className="swim-input uppercase" />
            </Field>
            <Field label="HS code">
              <input value={hsCode} onChange={(e) => setHsCode(e.target.value)} placeholder="e.g. 8471.30" className="swim-input font-mono" required />
            </Field>
            <Field label="Currency">
              <input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} placeholder="USD" className="swim-input uppercase" required />
            </Field>
            <Field label="Goods value">
              <MoneyInput value={goodsValue} onChange={setGoodsValue} />
            </Field>
            <Field label="International freight">
              <MoneyInput value={freight} onChange={setFreight} />
            </Field>
            <Field label="Insurance">
              <MoneyInput value={insurance} onChange={setInsurance} />
            </Field>
            <Field label="Brokerage estimate">
              <MoneyInput value={brokerage} onChange={setBrokerage} />
            </Field>
            <Field label="Port / handling fees">
              <MoneyInput value={portFees} onChange={setPortFees} />
            </Field>
            <Field label="Local delivery">
              <MoneyInput value={localDelivery} onChange={setLocalDelivery} />
            </Field>
            <Field label="Quantity">
              <input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="swim-input" />
            </Field>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.07] p-3 text-[10px] text-rose-200 flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div><div className="font-bold">{error}</div>{guidance && <div className="mt-1 text-rose-300/75">{guidance}</div>}</div>
            </div>
          )}

          <button disabled={loading} className="w-full rounded-xl bg-gradient-to-r from-[#14B8A6] to-[#0A86FF] px-4 py-3 text-[10px] font-black uppercase tracking-wider text-white disabled:opacity-50">
            {loading ? 'Calculating…' : 'Calculate landed cost'}
          </button>
        </form>

        <section className="rounded-[22px] border border-[#1a3854] bg-[#091728] overflow-hidden">
          {!result ? (
            <div className="min-h-[520px] grid place-items-center p-8 text-center">
              <div>
                <div className="mx-auto h-14 w-14 rounded-2xl border border-[#14B8A6]/25 bg-[#14B8A6]/10 grid place-items-center text-[#68e6d4]">
                  <Calculator className="h-6 w-6" />
                </div>
                <h4 className="mt-4 text-base font-bold text-white">Estimate before you commit</h4>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500 max-w-md">
                  SWIM will show customs value, each applicable duty or tax, ancillary costs, estimated landed cost and the official source attached to every loaded rule.
                </p>
              </div>
            </div>
          ) : (
            <div>
              <div className="p-5 border-b border-[#18324b]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[9px] uppercase tracking-[0.16em] font-black text-[#68e6d4]">{destinationName} estimate</div>
                    <h4 className="mt-1 text-lg font-black text-white">{money(result.estimate.estimatedLandedCostMinor)} landed</h4>
                    <p className="mt-1 text-[10px] text-slate-500">Approximately {money(perUnit)} per unit across {qty.toLocaleString()} unit{qty === 1 ? '' : 's'}.</p>
                  </div>
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-px bg-[#18324b]">
                <Metric icon={PackageSearch} label="Customs value" value={money(result.estimate.customsValueMinor)} />
                <Metric icon={Landmark} label="Duties & taxes" value={money(result.estimate.customsChargesMinor)} />
                <Metric icon={ReceiptText} label="Other landing costs" value={money(result.estimate.ancillaryCostsMinor)} />
                <Metric icon={Calculator} label="Landed cost / unit" value={money(perUnit)} />
              </div>

              <div className="p-5">
                <h5 className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Duty & tax breakdown</h5>
                <div className="mt-3 space-y-2">
                  {result.estimate.chargeLines.length ? result.estimate.chargeLines.map((line) => {
                    const url = safeSourceUrl(line.source.sourceUrl);
                    return (
                      <div key={line.ruleId} className="rounded-xl border border-[#18324b] bg-[#07121f] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[11px] font-bold text-slate-200">{line.label}</div>
                            <div className="mt-1 text-[9px] text-slate-600">
                              {line.rateBps != null ? `${(line.rateBps / 100).toFixed(2)}% · ` : ''}
                              Basis {money(line.basisMinor)}
                            </div>
                          </div>
                          <div className="text-sm font-black text-white">{money(line.amountMinor)}</div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[8px] text-slate-600">
                          <span>{line.source.authority} · verified {new Date(line.source.verifiedAt).toLocaleDateString()}</span>
                          {url && <a href={url} target="_blank" rel="noopener noreferrer" className="text-[#74d0ff] hover:text-white inline-flex items-center gap-1">Official source <ExternalLink className="h-3 w-3" /></a>}
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="rounded-xl border border-[#18324b] bg-[#07121f] p-4 text-[10px] text-slate-500">
                      No charge lines were returned for this verified rule set.
                    </div>
                  )}
                </div>

                <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 flex gap-2 text-[9px] leading-relaxed text-amber-100/80">
                  <FileCheck2 className="h-4 w-4 shrink-0 text-amber-300" />
                  <span>{result.disclaimer}</span>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[9px] font-bold uppercase tracking-[0.11em] text-slate-500">{label}</span>{children}</label>;
}

function MoneyInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <input type="number" min="0" step="0.01" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0.00" className="swim-input" />;
}

function Metric({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="bg-[#091728] p-4">
      <Icon className="h-4 w-4 text-[#68e6d4]" />
      <div className="mt-3 text-[8px] uppercase tracking-[0.14em] font-black text-slate-600">{label}</div>
      <div className="mt-1 text-lg font-black text-white">{value}</div>
    </div>
  );
}
