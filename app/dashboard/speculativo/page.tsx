// app/dashboard/speculativo/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import {
  AssetPortafoglio, ContoFlag, FondoPensione, Liquidita, MESI, statoAttuale,
} from '@/types/index'
import {
  Correlazione, NOTA_FISCALE, QualitaCopertura, TipoStrumento,
  betaPosizione, calcolaGrigliaMercato, calcolaScenari, calcolaSizing,
  corrPosizione, qualitaCopertura,
} from '@/lib/speculativoCalculations'
import SpeculativoInfoBox from '@/components/speculativo/SpeculativoInfoBox'

type QuoteInfo = { price: number }
type Fonte = 'riserva' | 'liquidita' | 'entrambe'

interface AssetRow { id: string; nome: string; ticker: string; valore: number; azionario: boolean }
interface Dati { patrimonio: number; riserva: number; liquidita: number; riservaAsset: number; assets: AssetRow[] }
interface Candidato {
  tipo: TipoStrumento; ticker: string; prezzo: string
  corr: Correlazione | null; stato: 'idle' | 'loading' | 'errore'; errore: string
}

const CAND_VUOTO = (tipo: TipoStrumento): Candidato => ({ tipo, ticker: '', prezzo: '', corr: null, stato: 'idle', errore: '' })

const fmtEuro = (n: number) => `${n < 0 ? '-' : ''}€${Math.abs(Math.round(n)).toLocaleString('it-IT')}`
const fmtDelta = (n: number) => `${n > 0 ? '+' : ''}${fmtEuro(n)}`
const fmtPct = (n: number, d = 1) => `${n > 0 ? '+' : ''}${n.toFixed(d).replace('.', ',')}%`
const fmt2 = (n: number | null) => (n === null ? 'n.d.' : n.toFixed(2).replace('.', ','))
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

function Riga({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-sm text-stone-500">{label}</span>
      <div className="text-right">{children}</div>
    </div>
  )
}

function NumInput({ value, onChange, suffix }: { value: number; onChange: (v: number) => void; suffix: string }) {
  return (
    <div className="relative w-24">
      <input
        type="number" step="0.1" min="0" value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="input !py-1 pr-6 text-right font-mono"
      />
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-stone-400">{suffix}</span>
    </div>
  )
}

const CARD = 'rounded-xl border border-stone-200 bg-white p-4'

export default function SpeculativoPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [dati, setDati] = useState<Dati | null>(null)

  const [fonte, setFonte] = useState<Fonte>('riserva')
  const [rischioPct, setRischioPct] = useState(0.5)
  const [tettoPct, setTettoPct] = useState(30)
  const [stopPct, setStopPct] = useState(10)
  const [targetPct, setTargetPct] = useState(20)

  const [selez, setSelez] = useState<Set<string>>(new Set())
  const [paniereAperto, setPaniereAperto] = useState(false)

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
      const fondo = ultimiPerChiave((fondoRes.data ?? []) as FondoPensione[], r => r.fondo)
        .reduce((s, f) => s + (f.saldo ?? 0), 0)
      const valorePort = port.reduce((s, a) => s + valoreAsset(a, prezzi), 0)

      const assets: AssetRow[] = port
        .map((a, i) => ({
          id: a.id ?? String(i),
          nome: a.nome || a.descrizione || a.asset || a.ticker,
          ticker: a.ticker ?? '',
          valore: valoreAsset(a, prezzi),
          azionario: a.classe_rischio === 'azionario',
        }))
        .filter(a => a.valore > 0)
        .sort((x, y) => y.valore - x.valore)
      const azionari = assets.filter(a => a.azionario)

      setSelez(new Set((azionari.length > 0 ? azionari : assets).map(a => a.id)))
      setDati({ patrimonio: liquidita + valorePort + fondo, riserva: riservaAsset + riservaLiq, liquidita, riservaAsset, assets })
      setLoading(false)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const aggiorna = (i: number, patch: Partial<Candidato>) =>
    setCands(cs => cs.map((c, k) => (k === i ? { ...c, ...patch } : c)))

  const long = useMemo(() => (dati ? dati.assets.filter(a => selez.has(a.id)) : []), [dati, selez])
  const valoreLong = long.reduce((s, a) => s + a.valore, 0)
  const basketLong = long
    .filter(a => a.ticker)
    .slice(0, 8)
    .map(a => `${encodeURIComponent(a.ticker)}:${Math.round(a.valore)}`)
    .join(',')

  function cambiaPaniere(next: Set<string>) {
    setSelez(next)
    setCands(cs => cs.map(c => ({ ...c, corr: null })))
  }
  function toggleAsset(id: string) {
    const next = new Set(selez)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    cambiaPaniere(next)
  }

  async function analizza(i: number) {
    const c = cands[i]
    const ticker = c.ticker.trim()
    if (!ticker) return
    aggiorna(i, { stato: 'loading', errore: '', corr: null })
    try {
      const [q, r] = await Promise.all([
        fetch(`/api/quote?tickers=${encodeURIComponent(ticker)}`).then(x => x.json()),
        fetch(`/api/correlazione?strumento=${encodeURIComponent(ticker)}&long=${basketLong}`),
      ])
      const prezzo: number | undefined = q?.[ticker]?.price
      const corrJson = await r.json()
      if (!r.ok) throw new Error(corrJson?.error ?? 'Analisi non riuscita')
      aggiorna(i, { stato: 'idle', prezzo: prezzo ? String(prezzo) : c.prezzo, corr: corrJson as Correlazione })
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

  const patrimonio = dati?.patrimonio ?? 0
  const sizing = useMemo(
    () => calcolaSizing({ patrimonio, disponibile, rischioPct, tettoPct, stopPct }),
    [patrimonio, disponibile, rischioPct, tettoPct, stopPct]
  )

  const cand = cands[sel]
  const prezzo = num(cand.prezzo)
  const betaPos = betaPosizione(cand.tipo, cand.corr)
  const capitale = override ?? sizing.importo
  const quantita = prezzo > 0 ? Math.floor(capitale / prezzo) : null
  const capitaleEff = quantita !== null ? quantita * prezzo : capitale

  const scenari = useMemo(
    () => calcolaScenari({ patrimonio, valoreLong, capitale: capitaleEff, stopPct, targetPct, betaPos }),
    [patrimonio, valoreLong, capitaleEff, stopPct, targetPct, betaPos]
  )
  const griglia = useMemo(
    () => calcolaGrigliaMercato({ patrimonio, valoreLong, capitale: capitaleEff, betaPos }),
    [patrimonio, valoreLong, capitaleEff, betaPos]
  )

  if (loading || !dati) {
    return <div className="flex items-center justify-center h-64 text-sm text-gray-400">Caricamento…</div>
  }

  const maxSlider = Math.max(Math.round(Math.max(disponibile, sizing.importo)), 1000)
  const pos = (v: number) => `${Math.min(100, (v / maxSlider) * 100)}%`
  const perdStop = (capitaleEff * stopPct) / 100
  const utileTarget = (capitaleEff * targetPct) / 100
  const pctPatr = (v: number) => (patrimonio > 0 ? (v / patrimonio) * 100 : 0)
  const pctDisp = disponibile > 0 ? (capitaleEff / disponibile) * 100 : 0
  const q = qualitaCopertura(corrPosizione(cand.tipo, cand.corr))
  const nomeScenario = { stop: 'Stop', neutro: 'Neutro', target: 'Target' }

  return (
    <div className="space-y-4">
      {/* Intestazione fissa */}
      <div className="sticky top-[65px] lg:top-0 z-20 -mx-4 md:-mx-6 -mt-4 md:-mt-6 px-4 md:px-6 py-3 bg-surface-50 border-b border-surface-200">
        <div className="flex items-center gap-1.5">
          <h1 className="font-serif text-xl text-stone-800">Speculativo</h1>
          <SpeculativoInfoBox />
          <p className="ml-2 hidden sm:block text-sm text-stone-500">
            Quanto capitale libero usare per uno short di breve periodo.
          </p>
        </div>
      </div>

      {/* Parametri + strumento */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className={`${CARD} divide-y divide-stone-100`}>
          <Riga label="Patrimonio totale"><span className="font-mono text-sm text-stone-800">{fmtEuro(patrimonio)}</span></Riga>
          <Riga label="Capitale disponibile">
            <div className="flex flex-col items-end gap-1">
              <span className="font-mono text-sm text-stone-800">{fmtEuro(disponibile)}</span>
              <div className="flex rounded-lg bg-surface-50 p-0.5 text-xs">
                {([['riserva', 'Riserva'], ['liquidita', 'Liquidità'], ['entrambe', 'Entrambe']] as [Fonte, string][]).map(([k, l]) => (
                  <button
                    key={k} onClick={() => { setFonte(k); setOverride(null) }}
                    className={`rounded-md px-2 py-0.5 transition-colors ${fonte === k ? 'bg-white text-brand-700 font-medium shadow-sm' : 'text-stone-500'}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </Riga>
          <div>
            <button onClick={() => setPaniereAperto(v => !v)} className="flex w-full items-center justify-between gap-3 py-2 text-left">
              <span className="text-sm text-stone-500">Paniere long</span>
              <span className="font-mono text-sm text-stone-800">
                {long.length} asset · {fmtEuro(valoreLong)} <span className="text-stone-400">{paniereAperto ? '▴' : '▾'}</span>
              </span>
            </button>
            {paniereAperto && (
              <div className="mb-2 rounded-lg bg-surface-50 p-2">
                <div className="mb-1 flex gap-3 text-xs text-brand-700">
                  <button onClick={() => cambiaPaniere(new Set(dati.assets.filter(a => a.azionario).map(a => a.id)))}>Solo azionari</button>
                  <button onClick={() => cambiaPaniere(new Set(dati.assets.map(a => a.id)))}>Tutti</button>
                  <button onClick={() => cambiaPaniere(new Set())}>Nessuno</button>
                </div>
                <div className="max-h-44 overflow-y-auto">
                  {dati.assets.map(a => (
                    <label key={a.id} className="flex items-center gap-2 py-1 text-xs text-stone-600">
                      <input type="checkbox" checked={selez.has(a.id)} onChange={() => toggleAsset(a.id)} className="accent-brand-600" />
                      <span className="min-w-0 flex-1 truncate">{a.nome}{!a.ticker && <span className="text-amber-600"> · senza ticker</span>}</span>
                      <span className="font-mono text-stone-500">{fmtEuro(a.valore)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <Riga label="Perdita max (% patrimonio)"><NumInput value={rischioPct} onChange={v => { setRischioPct(v); setOverride(null) }} suffix="%" /></Riga>
          <Riga label="Tetto su disponibile"><NumInput value={tettoPct} onChange={v => { setTettoPct(v); setOverride(null) }} suffix="%" /></Riga>
          <Riga label="Stop loss"><NumInput value={stopPct} onChange={v => { setStopPct(v); setOverride(null) }} suffix="%" /></Riga>
          <Riga label="Target"><NumInput value={targetPct} onChange={setTargetPct} suffix="%" /></Riga>
        </div>

        <div className={CARD}>
          <div className="flex rounded-lg bg-surface-50 p-0.5 text-sm">
            {['A', 'B'].map((l, i) => (
              <button
                key={l} onClick={() => { setSel(i); setOverride(null) }}
                className={`flex-1 rounded-md px-3 py-1 transition-colors ${sel === i ? 'bg-white text-brand-700 font-medium shadow-sm' : 'text-stone-500'}`}
              >
                Strumento {l}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <label className="block text-xs text-stone-500">Tipo
              <select value={cand.tipo} onChange={e => aggiorna(sel, { tipo: e.target.value as TipoStrumento, corr: null })} className="input mt-1 !py-1">
                <option value="etf_inverso">ETF inverso</option>
                <option value="azione">Azione short</option>
              </select>
            </label>
            <label className="block text-xs text-stone-500">Ticker (Yahoo)
              <input value={cand.ticker} onChange={e => aggiorna(sel, { ticker: e.target.value.toUpperCase(), corr: null })} className="input mt-1 !py-1 font-mono" />
            </label>
            <label className="block text-xs text-stone-500">Prezzo
              <input value={cand.prezzo} onChange={e => aggiorna(sel, { prezzo: e.target.value })} inputMode="decimal" className="input mt-1 !py-1 font-mono" />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={() => analizza(sel)} disabled={!cand.ticker.trim() || cand.stato === 'loading' || !basketLong} className="btn-secondary !py-1">
              {cand.stato === 'loading' ? 'Analisi…' : 'Analizza'}
            </button>
            {q && <span className={`text-xs rounded-full border px-2.5 py-0.5 ${BADGE[q].cls}`}>{BADGE[q].testo}</span>}
            {cand.stato === 'errore' && <span className="text-xs text-red-600">{cand.errore}</span>}
            {!basketLong && <span className="text-xs text-amber-700">Seleziona almeno un asset con ticker nel paniere.</span>}
          </div>
          {cand.corr && (
            <p className="mt-2 font-mono text-xs text-stone-500">
              correlazione {fmt2(corrPosizione(cand.tipo, cand.corr))} · beta {fmt2(betaPos)} · {cand.corr.n} giorni
            </p>
          )}
          <p className="mt-2 text-xs leading-snug text-stone-400">
            {cand.tipo === 'etf_inverso' ? 'Ricalcolo giornaliero: su settimane o mesi può discostarsi dal rendimento atteso. ' : ''}
            {NOTA_FISCALE[cand.tipo]}
          </p>
        </div>

        {/* Capitale e slider */}
        <div className={CARD}>
          <p className="text-sm text-stone-500">Capitale impiegato</p>
          <p className="font-serif text-3xl text-stone-800">{fmtEuro(capitaleEff)}</p>
          <p className="text-xs text-stone-400">
            {override === null ? `suggerito, limita il ${sizing.vincolo === 'rischio' ? 'rischio' : 'tetto sul capitale'}` : `scelto da te (suggerito ${fmtEuro(sizing.importo)})`}
            {override !== null && <button onClick={() => setOverride(null)} className="ml-1 text-brand-700 hover:underline">ripristina</button>}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-stone-100 pt-3">
            <div><p className="text-xs text-stone-400">Quantità</p><p className="font-mono text-sm text-stone-800">{quantita === null ? 'serve prezzo' : quantita.toLocaleString('it-IT')}</p></div>
            <div><p className="text-xs text-stone-400">Disponibile usato</p><p className="font-mono text-sm text-stone-800">{pctDisp.toFixed(0)}%</p></div>
            <div><p className="text-xs text-stone-400">Perdita a stop</p><p className="font-mono text-sm text-red-700">{fmtEuro(-perdStop)}</p><p className="font-mono text-xs text-stone-400">{fmtPct(-pctPatr(perdStop), 2)} patr.</p></div>
            <div><p className="text-xs text-stone-400">Utile a target</p><p className="font-mono text-sm text-emerald-700">{fmtDelta(utileTarget)}</p><p className="font-mono text-xs text-stone-400">{fmtPct(pctPatr(utileTarget), 2)} patr.</p></div>
          </div>
          <div className="relative mt-4">
            <input
              type="range" min={0} max={maxSlider} step={Math.max(50, Math.round(maxSlider / 200))}
              value={Math.min(capitale, maxSlider)} onChange={e => setOverride(Number(e.target.value))}
              className="w-full accent-brand-600" aria-label="Capitale impiegato"
            />
            <div className="pointer-events-none relative h-2">
              <span className="absolute top-0 h-2 w-0.5 -translate-x-1/2 bg-red-500" style={{ left: pos(sizing.limiteRischio) }} />
              <span className="absolute top-0 h-2 w-0.5 -translate-x-1/2 bg-accent2-600" style={{ left: pos(sizing.limiteCapitale) }} />
            </div>
          </div>
          <div className="mt-2 space-y-0.5 text-sm text-stone-600">
            <p><span className="text-red-600">▮</span> Limite rischio <span className="font-mono">{fmtEuro(sizing.limiteRischio)}</span></p>
            <p><span className="text-accent2-600">▮</span> Limite capitale <span className="font-mono">{fmtEuro(sizing.limiteCapitale)}</span></p>
            <p className="text-xs text-stone-400">Il più basso è il suggerito.</p>
          </div>
        </div>
      </div>

      {/* Scenari, mercato, confronto */}
      <div className="grid gap-4 xl:grid-cols-3">
        {/* Scenari */}
        <div className={CARD}>
        <p className="mb-2 text-sm font-medium text-stone-700">Scenari sul patrimonio</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-right text-stone-400">
              <th className="w-20 pb-1 text-left font-medium" />
              {scenari.map(s => <th key={s.chiave} className="pb-1 font-medium">{nomeScenario[s.chiave]}</th>)}
            </tr>
          </thead>
          <tbody className="font-mono text-right">
            <tr className="border-t border-stone-100">
              <td className="py-1 text-left font-sans text-stone-500">Posizione</td>
              {scenari.map(s => <td key={s.chiave} className="py-1">{fmtDelta(s.pnlShort)}</td>)}
            </tr>
            <tr className="border-t border-stone-100">
              <td className="py-1 text-left font-sans text-stone-500">Long</td>
              {scenari.map(s => (
                <td key={s.chiave} className="py-1">
                  {s.mercatoPct === null && s.chiave !== 'neutro' ? 'n.d.' : fmtDelta(s.pnlLong)}
                  {s.mercatoPct !== null && s.chiave !== 'neutro' && <span className="block text-xs text-stone-400">{fmtPct(s.mercatoPct, 0)}</span>}
                </td>
              ))}
            </tr>
            <tr className="border-t border-stone-100 font-semibold">
              <td className="py-1 text-left font-sans text-stone-600">Variazione</td>
              {scenari.map(s => (
                <td key={s.chiave} className={`py-1 ${s.deltaNetto < 0 ? 'text-red-700' : s.deltaNetto > 0 ? 'text-emerald-700' : 'text-stone-800'}`}>
                  {fmtDelta(s.deltaNetto)}
                  <span className="block text-xs font-normal text-stone-400">{fmtPct(pctPatr(s.deltaNetto), 2)}</span>
                </td>
              ))}
            </tr>
            <tr className="border-t border-stone-100">
              <td className="py-1 text-left font-sans text-stone-500">Patrimonio</td>
              {scenari.map(s => <td key={s.chiave} className="py-1">{fmtEuro(s.patrimonioFinale)}</td>)}
            </tr>
          </tbody>
        </table>
        {betaPos === null && <p className="mt-2 text-xs text-amber-700">Premi Analizza per stimare l&apos;effetto sui long: per ora vedi solo la posizione.</p>}
        {betaPos !== null && Math.abs(betaPos) < 0.15 && <p className="mt-2 text-xs text-amber-700">Beta vicino a zero: effetto sui long non stimabile.</p>}
      </div>
        <div className={CARD}>
          <p className="mb-2 text-sm font-medium text-stone-700">Se i tuoi long si muovono di…</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-stone-400">
                <th className="pb-1 text-left font-medium">Mercato</th><th className="pb-1 font-medium">Senza short</th><th className="pb-1 font-medium">Con short</th>
              </tr>
            </thead>
            <tbody className="font-mono text-right">
              {griglia.map(r => (
                <tr key={r.mercatoPct} className="border-t border-stone-100">
                  <td className="py-1 text-left">{fmtPct(r.mercatoPct, 0)}</td>
                  <td className="py-1 text-stone-500">{fmtEuro(r.senzaShort)}</td>
                  <td className="py-1 text-stone-800">{r.conShort === null ? 'n.d.' : fmtEuro(r.conShort)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={CARD}>
          <p className="mb-2 text-sm font-medium text-stone-700">Confronto A / B (stesso capitale e stop)</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-stone-400"><th className="pb-1 text-left font-medium" /><th className="pb-1 font-medium">A</th><th className="pb-1 font-medium">B</th></tr>
            </thead>
            <tbody className="font-mono text-right">
              {([
                ['Tipo', (c: Candidato) => (c.tipo === 'etf_inverso' ? 'ETF inv.' : 'Azione')],
                ['Correlazione', (c: Candidato) => fmt2(corrPosizione(c.tipo, c.corr))],
                ['Beta sui long', (c: Candidato) => fmt2(betaPosizione(c.tipo, c.corr))],
                ['Se long -10%', (c: Candidato) => { const b = betaPosizione(c.tipo, c.corr); return b === null ? 'n.d.' : fmtDelta((capitaleEff * b * -10) / 100) }],
              ] as [string, (c: Candidato) => string][]).map(([label, fn]) => (
                <tr key={label} className="border-t border-stone-100">
                  <td className="py-1 text-left font-sans text-stone-500">{label}</td>
                  {cands.map((c, i) => <td key={i} className="py-1 text-stone-800">{fn(c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-stone-400">Promemoria fiscale generale, non consulenza: verifica con il commercialista.</p>
        </div>
      </div>
    </div>
  )
}
