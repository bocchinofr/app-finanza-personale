// app/dashboard/speculativo/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { createClient } from '@/lib/supabase'
import {
  AssetPortafoglio, ContoFlag, FondoPensione, Liquidita, MESI, statoAttuale,
} from '@/types/index'
import {
  Correlazione, NOTA_FISCALE, QualitaCopertura, TipoStrumento,
  betaPosizione, calcolaCurva, calcolaGrigliaMercato, calcolaScenari, calcolaSizing,
  corrPosizione, qualitaCopertura,
} from '@/lib/speculativoCalculations'
import SpeculativoInfoBox from '@/components/speculativo/SpeculativoInfoBox'

type QuoteInfo = { price: number }
type Fonte = 'riserva' | 'liquidita' | 'entrambe'

interface DatiPatrimonio {
  patrimonio: number
  valoreLong: number
  riserva: number
  liquidita: number
  riservaAsset: number
  basketLong: string
}

interface Candidato {
  tipo: TipoStrumento
  ticker: string
  prezzo: string
  corr: Correlazione | null
  stato: 'idle' | 'loading' | 'errore'
  errore: string
}

const CAND_VUOTO = (tipo: TipoStrumento): Candidato => ({
  tipo, ticker: '', prezzo: '', corr: null, stato: 'idle', errore: '',
})

const fmtEuro = (n: number) => `${n < 0 ? '-' : ''}€${Math.abs(Math.round(n)).toLocaleString('it-IT')}`
const fmtDelta = (n: number) => `${n > 0 ? '+' : ''}${fmtEuro(n)}`
const fmtPct = (n: number, d = 1) => `${n > 0 ? '+' : ''}${n.toFixed(d).replace('.', ',')}%`
const num = (s: string) => Number(s.replace(',', '.')) || 0

const BADGE: Record<QualitaCopertura, { testo: string; cls: string }> = {
  buona: { testo: 'Copertura affidabile', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  parziale: { testo: 'Copertura parziale', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  debole: { testo: 'Copertura debole', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  inversa: { testo: 'Non copre: si muove come i long', cls: 'bg-red-50 text-red-700 border-red-200' },
}

function valoreAsset(a: AssetPortafoglio, prezzi: Record<string, QuoteInfo>): number {
  const { quantita, prezzoCarico } = statoAttuale(a)
  const p = a.ticker && prezzi[a.ticker] ? prezzi[a.ticker].price : prezzoCarico
  return p * quantita
}

function ultimiPerChiave<T extends { anno: number; mese: string }>(righe: T[], chiave: (r: T) => string) {
  const m = new Map<string, T>()
  const ord = (r: T) => r.anno * 12 + MESI.indexOf(r.mese as (typeof MESI)[number])
  righe.forEach(r => {
    const k = chiave(r)
    const att = m.get(k)
    if (!att || ord(r) >= ord(att)) m.set(k, r)
  })
  return [...m.values()]
}

function Campo({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-stone-500">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-0.5 block text-[11px] text-stone-400">{hint}</span>}
    </label>
  )
}

function NumInput({ value, onChange, suffix }: { value: number; onChange: (v: number) => void; suffix: string }) {
  return (
    <div className="relative">
      <input
        type="number" step="0.1" min="0" value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="input pr-8 font-mono"
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400">{suffix}</span>
    </div>
  )
}

export default function SpeculativoPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [dati, setDati] = useState<DatiPatrimonio | null>(null)

  const [fonte, setFonte] = useState<Fonte>('riserva')
  const [rischioPct, setRischioPct] = useState(0.5)
  const [tettoPct, setTettoPct] = useState(30)
  const [stopPct, setStopPct] = useState(10)
  const [targetPct, setTargetPct] = useState(20)

  const [cands, setCands] = useState<Candidato[]>([CAND_VUOTO('etf_inverso'), CAND_VUOTO('azione')])
  const [sel, setSel] = useState(0)
  const [override, setOverride] = useState<number | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const [portRes, liqRes, fondoRes, flagRes] = await Promise.all([
        supabase.from('portafoglio').select('*').eq('user_id', user.id),
        supabase.from('liquidita').select('*').eq('user_id', user.id),
        supabase.from('fondo_pensione').select('*').eq('user_id', user.id),
        supabase.from('conto_flags').select('*').eq('user_id', user.id),
      ])
      const port = (portRes.data ?? []) as AssetPortafoglio[]
      const tickers = [...new Set(port.map(a => a.ticker).filter(Boolean))]
      let prezzi: Record<string, QuoteInfo> = {}
      if (tickers.length) {
        try {
          const res = await fetch(`/api/quote?tickers=${tickers.join(',')}`)
          if (res.ok) prezzi = await res.json()
        } catch { /* ripiego sul prezzo di carico */ }
      }

      const conti = ultimiPerChiave((liqRes.data ?? []) as Liquidita[], r => r.conto)
      const flags = (flagRes.data ?? []) as ContoFlag[]
      const liquidita = conti.reduce((s, c) => s + (c.saldo ?? 0), 0)
      const riservaLiq = conti
        .filter(c => flags.find(f => f.conto === c.conto)?.svincolata)
        .reduce((s, c) => s + (c.saldo ?? 0), 0)
      const riservaAsset = port.filter(a => a.svincolato).reduce((s, a) => s + valoreAsset(a, prezzi), 0)

      const fondiRighe = (fondoRes.data ?? []) as FondoPensione[]
      const fondo = ultimiPerChiave(fondiRighe, r => r.fondo).reduce((s, f) => s + (f.saldo ?? 0), 0)

      const valorePort = port.reduce((s, a) => s + valoreAsset(a, prezzi), 0)
      const azionari = port.filter(a => a.classe_rischio === 'azionario')
      const baseLong = azionari.length > 0 ? azionari : port
      const valoreLong = baseLong.reduce((s, a) => s + valoreAsset(a, prezzi), 0)
      const basketLong = baseLong
        .filter(a => a.ticker)
        .map(a => ({ t: a.ticker, v: valoreAsset(a, prezzi) }))
        .sort((x, y) => y.v - x.v)
        .slice(0, 8)
        .map(x => `${encodeURIComponent(x.t)}:${Math.round(x.v)}`)
        .join(',')

      setDati({
        patrimonio: liquidita + valorePort + fondo,
        valoreLong,
        riserva: riservaAsset + riservaLiq,
        liquidita,
        riservaAsset,
        basketLong,
      })
      setLoading(false)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const aggiorna = (i: number, patch: Partial<Candidato>) =>
    setCands(cs => cs.map((c, k) => (k === i ? { ...c, ...patch } : c)))

  async function analizza(i: number) {
    const c = cands[i]
    const ticker = c.ticker.trim()
    if (!ticker || !dati) return
    aggiorna(i, { stato: 'loading', errore: '', corr: null })
    try {
      const [q, r] = await Promise.all([
        fetch(`/api/quote?tickers=${encodeURIComponent(ticker)}`).then(x => x.json()),
        fetch(`/api/correlazione?strumento=${encodeURIComponent(ticker)}&long=${dati.basketLong}`),
      ])
      const prezzo: number | undefined = q?.[ticker]?.price
      const corrJson = await r.json()
      if (!r.ok) throw new Error(corrJson?.error ?? 'Analisi non riuscita')
      aggiorna(i, {
        stato: 'idle',
        prezzo: prezzo ? String(prezzo) : c.prezzo,
        corr: corrJson as Correlazione,
      })
    } catch (e) {
      aggiorna(i, { stato: 'errore', errore: e instanceof Error ? e.message : 'Errore' })
    }
  }

  const disponibile = useMemo(() => {
    if (!dati) return 0
    if (fonte === 'riserva') return dati.riserva
    if (fonte === 'liquidita') return dati.liquidita
    return dati.liquidita + dati.riservaAsset
  }, [dati, fonte])

  const sizing = useMemo(
    () => calcolaSizing({ patrimonio: dati?.patrimonio ?? 0, disponibile, rischioPct, tettoPct, stopPct }),
    [dati, disponibile, rischioPct, tettoPct, stopPct]
  )

  const cand = cands[sel]
  const prezzo = num(cand.prezzo)
  const betaPos = betaPosizione(cand.tipo, cand.corr)
  const capitale = override ?? sizing.importo
  const quantita = prezzo > 0 ? Math.floor(capitale / prezzo) : null
  const capitaleEff = quantita !== null ? quantita * prezzo : capitale

  const scenari = useMemo(
    () => calcolaScenari({
      patrimonio: dati?.patrimonio ?? 0, valoreLong: dati?.valoreLong ?? 0,
      capitale: capitaleEff, stopPct, targetPct, betaPos,
    }),
    [dati, capitaleEff, stopPct, targetPct, betaPos]
  )
  const griglia = useMemo(
    () => calcolaGrigliaMercato({
      patrimonio: dati?.patrimonio ?? 0, valoreLong: dati?.valoreLong ?? 0, capitale: capitaleEff, betaPos,
    }),
    [dati, capitaleEff, betaPos]
  )
  const maxSlider = Math.max(Math.round(Math.max(disponibile, sizing.importo)), 1000)
  const curva = useMemo(() => calcolaCurva(maxSlider, stopPct, targetPct), [maxSlider, stopPct, targetPct])

  if (loading || !dati) {
    return <div className="flex items-center justify-center h-64 text-sm text-gray-400">Caricamento…</div>
  }

  const perdStop = (capitaleEff * stopPct) / 100
  const utileTarget = (capitaleEff * targetPct) / 100
  const pctPatr = (v: number) => (dati.patrimonio > 0 ? (v / dati.patrimonio) * 100 : 0)
  const pctDisp = disponibile > 0 ? (capitaleEff / disponibile) * 100 : 0
  const etichetteScenario = { stop: 'Stop', neutro: 'Neutro', target: 'Target' }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1.5">
        <div>
          <h1 className="font-serif text-2xl text-stone-800">Speculativo</h1>
          <p className="text-sm text-stone-500">
            Quanto capitale libero usare per uno short di breve periodo, e cosa succede al patrimonio.
          </p>
        </div>
        <SpeculativoInfoBox />
      </div>

      {/* KPI */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <p className="text-sm text-stone-500">Patrimonio totale</p>
          <p className="mt-1 font-serif text-2xl text-stone-800">{fmtEuro(dati.patrimonio)}</p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <p className="text-sm text-stone-500">Capitale disponibile</p>
          <p className="mt-1 font-serif text-2xl text-stone-800">{fmtEuro(disponibile)}</p>
          <div className="mt-2 flex rounded-lg bg-surface-50 p-0.5 text-[11px]">
            {([['riserva', 'Riserva'], ['liquidita', 'Liquidità'], ['entrambe', 'Entrambe']] as [Fonte, string][]).map(([k, l]) => (
              <button
                key={k} onClick={() => { setFonte(k); setOverride(null) }}
                className={`flex-1 rounded-md px-2 py-1 transition-colors ${fonte === k ? 'bg-white text-brand-700 font-medium shadow-sm' : 'text-stone-500'}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <p className="text-sm text-stone-500">Valore long azionari</p>
          <p className="mt-1 font-serif text-2xl text-stone-800">{fmtEuro(dati.valoreLong)}</p>
          <p className="mt-0.5 text-xs text-stone-400">paniere usato per correlazione e scenari</p>
        </div>
      </div>

      {/* Parametri */}
      <div className="rounded-xl border border-stone-200 bg-white p-5">
        <p className="text-sm font-medium text-stone-700">Parametri di rischio</p>
        <div className="mt-3 grid gap-4 grid-cols-2 lg:grid-cols-4">
          <Campo label="Perdita max (% patrimonio)"><NumInput value={rischioPct} onChange={v => { setRischioPct(v); setOverride(null) }} suffix="%" /></Campo>
          <Campo label="Tetto su capitale disponibile"><NumInput value={tettoPct} onChange={v => { setTettoPct(v); setOverride(null) }} suffix="%" /></Campo>
          <Campo label="Stop loss"><NumInput value={stopPct} onChange={v => { setStopPct(v); setOverride(null) }} suffix="%" /></Campo>
          <Campo label="Target"><NumInput value={targetPct} onChange={setTargetPct} suffix="%" /></Campo>
        </div>
      </div>

      {/* Candidati */}
      <div className="grid gap-4 md:grid-cols-2">
        {cands.map((c, i) => {
          const q = qualitaCopertura(corrPosizione(c.tipo, c.corr))
          const attivo = sel === i
          return (
            <div key={i} className={`rounded-xl border bg-white p-5 transition-colors ${attivo ? 'border-brand-500 ring-1 ring-brand-500' : 'border-stone-200'}`}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-stone-700">Strumento {i === 0 ? 'A' : 'B'}</p>
                <button
                  onClick={() => { setSel(i); setOverride(null) }}
                  className={`text-xs rounded-full px-2.5 py-0.5 border ${attivo ? 'bg-brand-50 border-brand-200 text-brand-700' : 'border-stone-200 text-stone-500 hover:bg-surface-50'}`}
                >
                  {attivo ? 'In simulazione' : 'Usa per simulare'}
                </button>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <Campo label="Tipo">
                  <select
                    value={c.tipo}
                    onChange={e => aggiorna(i, { tipo: e.target.value as TipoStrumento })}
                    className="input"
                  >
                    <option value="etf_inverso">ETF inverso</option>
                    <option value="azione">Azione short</option>
                  </select>
                </Campo>
                <Campo label="Ticker (Yahoo)">
                  <input value={c.ticker} onChange={e => aggiorna(i, { ticker: e.target.value.toUpperCase() })} className="input font-mono" placeholder="es. XSPS.MI" />
                </Campo>
                <Campo label="Prezzo">
                  <input value={c.prezzo} onChange={e => aggiorna(i, { prezzo: e.target.value })} className="input font-mono" inputMode="decimal" />
                </Campo>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={() => analizza(i)} disabled={!c.ticker.trim() || c.stato === 'loading'} className="btn-secondary">
                  {c.stato === 'loading' ? 'Analisi…' : 'Analizza'}
                </button>
                {q && <span className={`text-xs rounded-full border px-2.5 py-0.5 ${BADGE[q].cls}`}>{BADGE[q].testo}</span>}
                {c.stato === 'errore' && <span className="text-xs text-red-600">{c.errore}</span>}
              </div>
              {c.corr && (
                <p className="mt-2 font-mono text-xs text-stone-500">
                  correlazione {corrPosizione(c.tipo, c.corr)?.toFixed(2).replace('.', ',')} · beta {betaPosizione(c.tipo, c.corr)?.toFixed(2).replace('.', ',')} · {c.corr.n} giorni
                </p>
              )}
              {c.tipo === 'etf_inverso' && (
                <p className="mt-2 text-[11px] text-amber-700">Ricalcolo giornaliero: su settimane o mesi può discostarsi dal rendimento atteso.</p>
              )}
            </div>
          )
        })}
      </div>

      {/* Sizing */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-stone-200 bg-white p-5 lg:col-span-1">
          <p className="text-sm text-stone-500">Capitale impiegato</p>
          <p className="mt-1 font-serif text-3xl text-stone-800">{fmtEuro(capitaleEff)}</p>
          <p className="mt-0.5 text-xs text-stone-400">
            {override === null
              ? `suggerito, limita il ${sizing.vincolo === 'rischio' ? 'rischio' : 'tetto sul capitale'}`
              : `scelto da te (suggerito ${fmtEuro(sizing.importo)})`}
          </p>
          <div className="mt-4 space-y-1.5 border-t border-stone-100 pt-4 text-sm">
            <div className="flex justify-between"><span className="text-stone-500">Quantità</span><span className="font-mono text-stone-800">{quantita === null ? 'inserisci prezzo' : quantita.toLocaleString('it-IT')}</span></div>
            <div className="flex justify-between"><span className="text-stone-500">Perdita a stop</span><span className="font-mono text-red-700">{fmtEuro(-perdStop)} ({fmtPct(-pctPatr(perdStop), 2)} patr.)</span></div>
            <div className="flex justify-between"><span className="text-stone-500">Utile a target</span><span className="font-mono text-emerald-700">{fmtDelta(utileTarget)} ({fmtPct(pctPatr(utileTarget), 2)} patr.)</span></div>
            <div className="flex justify-between"><span className="text-stone-500">Accumulo sottratto</span><span className="font-mono text-stone-800">{pctDisp.toFixed(0)}% del disponibile</span></div>
          </div>
          <p className="mt-3 text-[11px] text-stone-400">
            Limite rischio {fmtEuro(sizing.limiteRischio)} · limite capitale {fmtEuro(sizing.limiteCapitale)}
          </p>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-stone-700">Curva: quanto capitale, quanto rischio</p>
            {override !== null && (
              <button onClick={() => setOverride(null)} className="text-xs text-brand-700 hover:underline">Torna al suggerito</button>
            )}
          </div>
          <div className="mt-3 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curva} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#ececE1" vertical={false} />
                <XAxis dataKey="capitale" tickFormatter={v => `${Math.round(v / 1000)}k`} tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={v => `${Math.round(v / 1000)}k`} tick={{ fontSize: 11 }} width={36} />
                <Tooltip formatter={(v: number) => fmtEuro(v)} labelFormatter={l => `Capitale ${fmtEuro(Number(l))}`} />
                <ReferenceLine y={-(dati.patrimonio * rischioPct) / 100} stroke="#c65d3b" strokeDasharray="4 4" />
                <ReferenceLine x={Math.round(capitaleEff)} stroke="#3f6b4f" />
                <Line type="monotone" dataKey="perdita" name="Perdita a stop" stroke="#c65d3b" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="utile" name="Utile a target" stroke="#3f6b4f" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <input
            type="range" min={0} max={maxSlider} step={Math.max(50, Math.round(maxSlider / 200))}
            value={Math.min(capitale, maxSlider)}
            onChange={e => setOverride(Number(e.target.value))}
            className="mt-2 w-full accent-brand-600"
            aria-label="Capitale impiegato"
          />
          <p className="text-[11px] text-stone-400">Linea tratteggiata: perdita massima accettata. Linea verde: capitale attuale.</p>
        </div>
      </div>

      {/* Scenari */}
      <div>
        <p className="mb-2 text-sm font-medium text-stone-700">Scenari sul patrimonio</p>
        <div className="grid gap-4 md:grid-cols-3">
          {scenari.map(s => (
            <div key={s.chiave} className="rounded-xl border border-stone-200 bg-white p-5">
              <p className="text-sm text-stone-500">{etichetteScenario[s.chiave]}</p>
              <p className={`mt-1 font-serif text-2xl ${s.deltaNetto < 0 ? 'text-red-700' : s.deltaNetto > 0 ? 'text-emerald-700' : 'text-stone-800'}`}>
                {fmtDelta(s.deltaNetto)}
              </p>
              <p className="text-xs text-stone-400">{fmtPct(pctPatr(s.deltaNetto), 2)} del patrimonio · finale {fmtEuro(s.patrimonioFinale)}</p>
              <div className="mt-3 space-y-1 border-t border-stone-100 pt-3 text-sm">
                <div className="flex justify-between"><span className="text-stone-500">Posizione</span><span className="font-mono">{fmtDelta(s.pnlShort)}</span></div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Long {s.mercatoPct !== null && s.chiave !== 'neutro' ? `(${fmtPct(s.mercatoPct, 0)})` : ''}</span>
                  <span className="font-mono">{s.mercatoPct === null && s.chiave !== 'neutro' ? 'n.d.' : fmtDelta(s.pnlLong)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        {betaPos === null && (
          <p className="mt-2 text-xs text-amber-700">Premi Analizza sullo strumento in simulazione per stimare l&apos;effetto sui long. Nel frattempo vedi solo la posizione.</p>
        )}
        {betaPos !== null && Math.abs(betaPos) < 0.15 && (
          <p className="mt-2 text-xs text-amber-700">Beta vicino a zero: la posizione non si muove con i long, effetto sui long non stimabile.</p>
        )}
      </div>

      {/* Mercato e confronto */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <p className="text-sm font-medium text-stone-700">Se il mercato (i tuoi long) si muove di…</p>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-stone-400">
                <th className="pb-2 font-medium">Mercato</th><th className="pb-2 font-medium">Senza short</th><th className="pb-2 font-medium">Con short</th>
              </tr>
            </thead>
            <tbody>
              {griglia.map(r => (
                <tr key={r.mercatoPct} className="border-t border-stone-100">
                  <td className="py-1.5 font-mono">{fmtPct(r.mercatoPct, 0)}</td>
                  <td className="py-1.5 font-mono text-stone-600">{fmtEuro(r.senzaShort)}</td>
                  <td className="py-1.5 font-mono text-stone-800">{r.conShort === null ? 'n.d.' : fmtEuro(r.conShort)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <p className="text-sm font-medium text-stone-700">Confronto strumenti (stesso capitale e stop)</p>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-stone-400">
                <th className="pb-2 font-medium" />
                <th className="pb-2 font-medium">A</th>
                <th className="pb-2 font-medium">B</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Tipo', (c: Candidato) => (c.tipo === 'etf_inverso' ? 'ETF inverso' : 'Azione short')],
                ['Correlazione', (c: Candidato) => { const v = corrPosizione(c.tipo, c.corr); return v === null ? 'n.d.' : v.toFixed(2).replace('.', ',') }],
                ['Beta sui long', (c: Candidato) => { const v = betaPosizione(c.tipo, c.corr); return v === null ? 'n.d.' : v.toFixed(2).replace('.', ',') }],
                ['Mercato -10%', (c: Candidato) => { const b = betaPosizione(c.tipo, c.corr); return b === null ? 'n.d.' : fmtDelta((capitaleEff * b * -10) / 100) }],
                ['Perdita a stop', () => fmtEuro(-perdStop)],
              ].map(([label, fn]) => (
                <tr key={label as string} className="border-t border-stone-100">
                  <td className="py-1.5 text-stone-500">{label as string}</td>
                  {cands.map((c, i) => <td key={i} className="py-1.5 font-mono text-stone-800">{(fn as (c: Candidato) => string)(c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 space-y-1 border-t border-stone-100 pt-3 text-[11px] text-stone-500">
            {cands.map((c, i) => <p key={i}><strong>{i === 0 ? 'A' : 'B'}:</strong> {NOTA_FISCALE[c.tipo]}</p>)}
            <p className="text-stone-400">Promemoria generale, non consulenza fiscale: verifica con il commercialista.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
