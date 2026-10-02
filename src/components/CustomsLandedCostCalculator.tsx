import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ExternalLink,
  FileSearch,
  Landmark,
  RefreshCw,
  ShieldCheck
} from 'lucide-react';

interface Props {
  token: string | null;
  userRole: string;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

interface Coverage {
  jurisdictionCode: string;
  ruleCount: number;
  latestVerifiedAt?: string;
  versions: string[];
}

interface Estimate {
  customsValue: number;
  importDuty: number;
  customsServiceCharge: number;
  excise: number;
  environmentalLevy: number;
  otherTaxes: number;
  vat: number;
  brokerage: number;
  portFees: number;
  localDelivery: number;
  totalBorderCharges: number;
  totalLandedCost: number;
  ruleId: string;
  ruleVersion: string;
  officialSourceUrl: string;
  confidence: 'HIGH' | 'MEDIUM' | 'REVIEW_REQUIRED';
}

interface EstimateResponse {
  estimate: Estimate;
  source: {
    title: string;
    url: string;
    verifiedAt: string;
    version: string;
  };
  disclaimer: string;
}

const jurisdictions = [
  ['LC', 'Saint Lucia'],
  ['BB', 'Barbados'],
  ['DM', 'Dominica'],
  ['GD', 'Grenada'],
  ['VC', 'St. Vincent & the Grenadines'],
  ['AG', 'Antigua & Barbuda'],
  ['KN', 'St. Kitts & Nevis'],
  ['TT', 'Trinidad & Tobago'],
  ['JM', 'Jamaica']
] as const;

const money = (value: number, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2
  }).format(Number(value || 0));

export const CustomsLandedCostCalculator: React.FC<Props> = ({
  token,
  userRole,
  showToast
}) => {
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [loadingCoverage, setLoadingCoverage] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<EstimateResponse | null>(null);
  const [currency, setCurrency] = useState('XCD');
  const [form, setForm] = useState({
    jurisdictionCode: 'LC',
    hsCode: '',
    goodsValue: '',
    freight: '',
    insurance: '',
    otherDutiableCharges: '',
    brokerage: '',
    portFees: '',
    localDelivery: '',
    concessionPercent: ''
  });

  const canCalculate = ['admin', 'manager', 'operator'].includes(userRole);

  const selectedCoverage = useMemo(
    () => coverage.find((item) => item.jurisdictionCode === form.jurisdictionCode),
    [coverage, form.jurisdictionCode]
  );

  const loadCoverage = async () => {
    if (!token) return;
    setLoadingCoverage(true);
    try {
      const res = await fetch('/api/swim/customs/coverage', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Unable to load tariff coverage.');
      const data = await res.json();
      setCoverage(data.coverage || []);
    } catch (err: any) {
      showToast(err.message || 'Unable to load tariff coverage.', 'error');
    } finally {
      setLoadingCoverage(false);
    }
  };

  useEffect(() => {
    loadCoverage();
  }, [token]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token || !canCalculate) return;
    setCalculating(true);
    setResult(null);
    try {
      const payload = {
        jurisdictionCode: form.jurisdictionCode,
        hsCode: form.hsCode,
        goodsValue: Number(form.goodsValue || 0),
        freight: Number(form.freight || 0),
        insurance: Number(form.insurance || 0),
        otherDutiableCharges: Number(form.otherDutiableCharges || 0),
        brokerage: Number(form.brokerage || 0),
        portFees: Number(form.portFees || 0),
        localDelivery: Number(form.localDelivery || 0),
        concessionPercent: Number(form.concessionPercent || 0)
      };
      const res = await fetch('/api/swim/customs/estimate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to calculate customs estimate.');
      setResult(data);
    } catch (err: any) {
      showToast(err.message || 'Unable to calculate customs estimate.', 'error');
    } finally {
      setCalculating(false);
    }
  };

  const confidenceClass = result?.estimate.confidence === 'HIGH'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    : result?.estimate.confidence === 'MEDIUM'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
      : 'border-rose-500/30 bg-rose-500/10 text-rose-300';

  return (
    <div className="space-y-4 animate-fade-in" id="panel_swim_customs_landed_cost">
      <section className="relative overflow-hidden rounded-[24px] border border-[#1a3854] bg-[#091728] p-5 sm:p-6">
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_85%_10%,rgba(245,158,11,.16),transparent_28%),radial-gradient(circle_at_98%_84%,rgba(10,134,255,.14),transparent_34%)]" />
        <div className="relative flex flex-col xl:flex-row xl:items-center justify-between gap-5">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[0.19em] text-amber-300">Caribbean trade intelligence</div>
            <h3 className="mt-2 text-2xl sm:text-3xl font-black tracking-tight text-white">Duties & landed cost</h3>
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-slate-400">
              Estimate border charges using versioned jurisdiction rules and see the real landed cost before inventory reaches the warehouse.
            </p>
          </div>
          <button onClick={loadCoverage} className="self-start xl:self-auto px-3.5 py-2.5 rounded-xl border border-[#1a3854] bg-[#07121f] text-slate-300 text-xs font-bold flex items-center gap-2">
            <RefreshCw className={`h-4 w-4 ${loadingCoverage ? 'animate-spin' : ''}`} />
            Refresh tariff coverage
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,.8fr)_minmax(420px,1.2fr)] gap-4">
        <form onSubmit={submit} className="rounded-[22px] border border-[#1a3854] bg-[#091728] p-5 space-y-4 self-start">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Calculator className="h-4 w-4 text-amber-300" />
                Import estimate
              </h4>
              <p className="mt-1 text-[9px] text-slate-500">All monetary inputs should use the same currency.</p>
            </div>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="rounded-xl border border-[#244560] bg-[#07121f] px-2.5 py-2 text-[10px] font-bold text-slate-200">
              <option value="XCD">XCD</option>
              <option value="USD">USD</option>
              <option value="BBD">BBD</option>
              <option value="JMD">JMD</option>
              <option value="TTD">TTD</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Destination jurisdiction">
              <select value={form.jurisdictionCode} onChange={(e) => { setForm({ ...form, jurisdictionCode: e.target.value }); setResult(null); }}>
                {jurisdictions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </Field>
            <Field label="HS code" required>
              <input required inputMode="numeric" maxLength={14} value={form.hsCode} onChange={(e) => setForm({ ...form, hsCode: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="e.g. 847130" />
            </Field>
            <MoneyField label="Goods value" value={form.goodsValue} onChange={(value) => setForm({ ...form, goodsValue: value })} required />
            <MoneyField label="International freight" value={form.freight} onChange={(value) => setForm({ ...form, freight: value })} />
            <MoneyField label="Insurance" value={form.insurance} onChange={(value) => setForm({ ...form, insurance: value })} />
            <MoneyField label="Other dutiable charges" value={form.otherDutiableCharges} onChange={(value) => setForm({ ...form, otherDutiableCharges: value })} />
            <MoneyField label="Brokerage estimate" value={form.brokerage} onChange={(value) => setForm({ ...form, brokerage: value })} />
            <MoneyField label="Port / handling fees" value={form.portFees} onChange={(value) => setForm({ ...form, portFees: value })} />
            <MoneyField label="Local delivery" value={form.localDelivery} onChange={(value) => setForm({ ...form, localDelivery: value })} />
            <Field label="Duty concession %">
              <input type="number" min="0" max="100" step="0.01" value={form.concessionPercent} onChange={(e) => setForm({ ...form, concessionPercent: e.target.value })} placeholder="0" />
            </Field>
          </div>

          <div className={`rounded-xl border p-3 text-[9px] leading-relaxed ${selectedCoverage ? 'border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-200' : 'border-amber-500/20 bg-amber-500/[0.06] text-amber-200'}`}>
            {selectedCoverage ? (
              <div className="flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <strong>{selectedCoverage.ruleCount.toLocaleString()} tariff rules loaded</strong>
                  <div className="mt-0.5 opacity-70">
                    Latest source verification: {selectedCoverage.latestVerifiedAt ? new Date(selectedCoverage.latestVerifiedAt).toLocaleDateString() : 'Not recorded'} · Version{selectedCoverage.versions.length === 1 ? '' : 's'} {selectedCoverage.versions.join(', ')}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <strong>No verified tariff dataset is loaded for this jurisdiction.</strong>
                  <div className="mt-0.5 opacity-70">SWIM will not guess duty rates. A platform administrator must load an official rule set first.</div>
                </div>
              </div>
            )}
          </div>

          <button
            disabled={calculating || !canCalculate || !selectedCoverage}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-[#0A86FF] text-white text-xs font-black disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {calculating ? 'Calculating...' : 'Calculate landed cost'}
          </button>
        </form>

        <div className="rounded-[22px] border border-[#1a3854] bg-[#091728] overflow-hidden">
          {!result ? (
            <div className="min-h-[520px] p-8 flex items-center justify-center text-center">
              <div>
                <Landmark className="h-11 w-11 text-slate-700 mx-auto mb-3" />
                <h4 className="text-sm font-bold text-white">Your import estimate will appear here</h4>
                <p className="mt-1 max-w-md text-[10px] leading-relaxed text-slate-500">
                  SWIM shows each charge separately, the source tariff version and a confidence indicator instead of hiding everything behind one total.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="p-5 border-b border-[#18324b]">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div>
                    <div className="text-[8px] uppercase tracking-[0.15em] text-slate-600 font-black">Estimated landed cost</div>
                    <div className="mt-1 text-3xl font-black tracking-tight text-white">{money(result.estimate.totalLandedCost, currency)}</div>
                    <div className="mt-1 text-[9px] text-slate-500">Border charges: {money(result.estimate.totalBorderCharges, currency)}</div>
                  </div>
                  <span className={`self-start px-2.5 py-1 rounded-full border text-[8px] font-black uppercase tracking-wider ${confidenceClass}`}>
                    {result.estimate.confidence.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>

              <div className="p-5">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  <Charge label="Customs value" value={result.estimate.customsValue} currency={currency} />
                  <Charge label="Import duty" value={result.estimate.importDuty} currency={currency} />
                  <Charge label="Customs service" value={result.estimate.customsServiceCharge} currency={currency} />
                  <Charge label="Excise" value={result.estimate.excise} currency={currency} />
                  <Charge label="Environmental levy" value={result.estimate.environmentalLevy} currency={currency} />
                  <Charge label="Other taxes" value={result.estimate.otherTaxes} currency={currency} />
                  <Charge label="VAT / consumption tax" value={result.estimate.vat} currency={currency} />
                  <Charge label="Brokerage" value={result.estimate.brokerage} currency={currency} />
                  <Charge label="Port fees" value={result.estimate.portFees} currency={currency} />
                  <Charge label="Local delivery" value={result.estimate.localDelivery} currency={currency} />
                </div>

                <div className="mt-5 rounded-xl border border-[#1a3854] bg-[#07121f] p-4">
                  <div className="flex items-start gap-3">
                    <FileSearch className="h-4 w-4 text-[#74d0ff] mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[9px] uppercase tracking-[0.14em] text-slate-600 font-black">Official rule source</div>
                      <div className="mt-1 text-[11px] font-bold text-slate-200">{result.source.title}</div>
                      <div className="mt-1 text-[9px] text-slate-500">
                        Version {result.source.version} · Verified {new Date(result.source.verifiedAt).toLocaleDateString()}
                      </div>
                      <a
                        href={result.source.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-2 inline-flex items-center gap-1.5 text-[9px] font-bold text-[#74d0ff] hover:text-white"
                      >
                        View official source <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-3 text-[9px] leading-relaxed text-amber-100/70">
                  {result.disclaimer}
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
};

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

function MoneyField({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return (
    <Field label={label} required={required}>
      <input required={required} type="number" min="0" step="0.01" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0.00" />
    </Field>
  );
}

function Charge({ label, value, currency }: { label: string; value: number; currency: string }) {
  return (
    <div className="rounded-xl border border-[#18324b] bg-[#07121f] p-3">
      <div className="text-[7px] uppercase tracking-[0.13em] text-slate-600 font-black">{label}</div>
      <div className="mt-1 text-[11px] font-bold text-slate-200">{money(value, currency)}</div>
    </div>
  );
}
