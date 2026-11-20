'use client'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import {
  AssetPortafoglio, Liquidita, ContoFlag, AccumuloAsset, AccumuloTranche,
  statoAttuale, PROFILO_DINAMICO_LABEL,
} from '@/types'
import {
  calcolaPianoAsset, pesiDistribuzione, ripartisciRiserva, SOGLIE_DEFAULT,
  type Distribuzione, type PianoConfig, type PianoAsset, type RigaPiano,
} from '@/lib/pianoAccumulo'
import InfoAccumuloModal from '@/components/InfoAccumuloModal'

type QuoteInfo = { price: number; high52: number | null; changeFromHigh: number | null; changeFromMonth: number | null }

interface Props {
  portafoglio: AssetPortafoglio[]
  liquidita: Liquidita[]
  prezziAttuali: Record<string, QuoteInfo>
  behaviorLabel: string | null
  pmcMaxAumento?: number | null      // %, es. 2 = max +2% sul PMC
  bonusSottoPmc?: number | null      // frazione, 0.5 = +50% ogni -10% sotto PMC
  moltMax?: number | null
  onSaved?: () => void
  onSimula?: (assetId: string, importo: number) => void
  onAggiornaPrezzi?: () => void | Promise<void>
  loadingPrezzi?: boolean
}

interface DraftSoglia { soglia: number; peso: number }
interface DraftAsset { portafoglioId: string; quotaPct: string; distribuzione: Distribuzione; soglie: DraftSoglia[] }

const nf = (n: number, d = 0) => n.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })
const eur = (n: number) => `€${nf(n)}`
const prz = (n: number) => `€${nf(n, 2)}`
const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))

function valoreAttualeAsset(a: AssetPortafoglio, prezzi: Record<string, QuoteInfo>): number {
  const { quantita, prezzoCarico } = statoAttuale(a)
  const p = a.ticker && prezzi[a.ticker] ? prezzi[a.ticker].price : prezzoCarico
  return p * quantita
}

function ribassoDa(q?: QuoteInfo): number {
  if (!q) return 0
  if (q.changeFromHigh != null) return Math.max(0, -q.changeFromHigh) / 100
  if (q.high52) return Math.max(0, (q.high52 - q.price) / q.high52)
  return 0
}

function pesiEffettivi(d: DraftAsset): number[] {
  if (d.distribuzione === 'manuale') return d.soglie.map(s => s.peso)
  return pesiDistribuzione(d.soglie.length, d.distribuzione)
}

const nuovaDraft = (portafoglioId: string): DraftAsset => ({
  portafoglioId, quotaPct: '', distribuzione: 'crescente',
  soglie: SOGLIE_DEFAULT.map(s => ({ soglia: s, peso: 0 })),
})

/* ───────── Barra a scalini: soglie, posizione attuale ───────── */
function BarraSoglie({ righe, ribasso }: { righe: RigaPiano[]; ribasso: number }) {
  const maxSoglia = Math.max(...righe.map(r => r.sogliaPct), 5)
  const scala = Math.max(maxSoglia * 1.15, ribasso * 100 * 1.05)
  const pos = (v: number) => `${Math.min((v / scala) * 100, 100)}%`
  return (
    <div className="relative h-14 mt-1 mb-2 select-none" role="img" aria-label={`Ribasso attuale ${nf(ribasso * 100, 1)}% dal massimo`}>
      <div className="absolute left-0 right-0 top-6 h-1.5 rounded-full bg-surface-100" />
      <div className="absolute left-0 top-6 h-1.5 rounded-full bg-brand-600" style={{ width: pos(ribasso * 100) }} />
      {righe.map(r => (
        <div key={r.sogliaPct} className="absolute top-0 -translate-x-1/2 flex flex-col items-center" style={{ left: pos(r.sogliaPct) }}>
          <span className={`text-[10px] tabular-nums ${r.scattata ? 'text-brand-700 font-semibold' : 'text-gray-400'}`}>−{nf(r.sogliaPct)}%</span>
          <span className={`mt-1.5 w-3 h-3 rounded-full border-2 ${r.scattata ? 'bg-brand-600 border-brand-600' : 'bg-white border-surface-300'}`} />
        </div>
      ))}
      <div className="absolute bottom-0 -translate-x-1/2 flex flex-col items-center" style={{ left: pos(ribasso * 100) }}>
        <span className="text-[9px] leading-none text-brand-700">▲</span>
        <span className="text-[10px] font-semibold text-brand-700 whitespace-nowrap">Ora −{nf(ribasso * 100, 1)}%</span>
      </div>
    </div>
  )
}

/* ───────── Barra capitale dell'asset ───────── */
function BarraCapitale({ piano }: { piano: PianoAsset }) {
  const q = piano.quota
  if (q <= 0) return null
  const storico = piano.righe.filter(r => r.storica).reduce((s, r) => s + r.importo, 0)
  const w = (v: number) => `${Math.min(Math.max((v / q) * 100, 0), 100)}%`
  const libero = Math.max(0, q - storico - piano.importoOra - piano.importoInAttesa)
  return (
    <div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-surface-100">
        <div className="bg-surface-300" style={{ width: w(storico) }} title="Tranche già sbloccate" />
        <div className="bg-brand-600" style={{ width: w(piano.importoOra) }} title="Da investire ora" />
        <div className="bg-brand-200" style={{ width: w(piano.importoInAttesa) }} title="Previsto sulle prossime soglie" />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[10px] text-gray-500">
        <span><i className="inline-block w-2 h-2 rounded-sm bg-surface-300 mr-1" />già sbloccate {eur(storico)}</span>
        <span><i className="inline-block w-2 h-2 rounded-sm bg-brand-600 mr-1" />ora {eur(piano.importoOra)}</span>
        <span><i className="inline-block w-2 h-2 rounded-sm bg-brand-200 mr-1" />prossime soglie {eur(piano.importoInAttesa)}</span>
        <span><i className="inline-block w-2 h-2 rounded-sm bg-surface-100 border border-surface-200 mr-1" />libero {eur(libero)}</span>
      </div>
    </div>
  )
}

/* ───────── Tabella tranche: righe cliccabili con calcolo passo-passo ───────── */
function StatoChip({ r }: { r: RigaPiano }) {
  if (r.ora) return <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-brand-600 text-white whitespace-nowrap">Da investire ora</span>
  if (r.storica) return <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-surface-100 text-gray-500 whitespace-nowrap">Già sbloccata</span>
  return <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-accent2-50 text-accent2-700 ring-1 ring-accent2-100 whitespace-nowrap">In attesa</span>
}

function Passaggio({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="shrink-0 w-5 h-5 mt-0.5 rounded-full bg-white ring-1 ring-surface-200 text-gray-500 text-[11px] font-semibold flex items-center justify-center">{n}</span>
      <span>{children}</span>
    </li>
  )
}

function DettaglioCalcolo({ r, quota, config }: { r: RigaPiano; quota: number; config: PianoConfig }) {
  if (r.storica) {
    return <p className="text-xs text-gray-500 leading-relaxed">Questa soglia è già stata superata: si presume che tu abbia già investito la tranche base ({eur(r.base)}), quindi non viene proposto nulla di nuovo.</p>
  }
  const sotto = r.pmcPrima > 0 ? ((r.pmcPrima - r.prezzoRif) / r.pmcPrima) * 100 : 0
  const molt = nf(r.moltiplicatore, 2)
  const g = (t: React.ReactNode) => <strong className="text-gray-800">{t}</strong>
  return (
    <ol className="space-y-2 text-xs text-gray-600 leading-relaxed">
      <Passaggio n={1}>{g('Tranche base')}: quota dell&apos;asset {eur(quota)} × peso {nf(r.pesoPct, 0)}% = {g(eur(r.base))}</Passaggio>
      <Passaggio n={2}>
        {r.sottoPmc ? (
          <>{g('Sei sotto PMC')}: il prezzo {!r.scattata && 'ipotetico '}({prz(r.prezzoRif)}) è sotto il tuo PMC ({prz(r.pmcPrima)}) del {nf(sotto, 1)}%, quindi compri di più.
            Moltiplicatore = 1 + {nf(config.bonusSottoPmc * 100)}% × ({nf(sotto, 1)}% ÷ 10) = {g(`×${molt}`)}{r.moltiplicatore >= config.moltMax - 1e-9 && ` (tetto massimo ×${nf(config.moltMax, 1)})`}.
            Quindi {eur(r.base)} × {molt} = {g(eur(r.base * r.moltiplicatore))}</>
        ) : (
          <>{g('Sei sopra PMC')}: il prezzo {!r.scattata && 'ipotetico '}({prz(r.prezzoRif)}) è sopra il tuo PMC ({prz(r.pmcPrima)}), quindi nessun bonus: {g('×1')}.</>
        )}
        {r.limitataDaQuota && <> Ridotto a {g(eur(r.lordo))}: non puoi superare la quota residua dell&apos;asset.</>}
      </Passaggio>
      {!r.sottoPmc && config.limitePmc != null && (
        <Passaggio n={3}>
          {g('Limite PMC')}: il nuovo PMC non può salire oltre +{nf(config.limitePmc * 100, 1)}%.{' '}
          {r.limitataDaPmc ? <>Per rispettarlo l&apos;importo scende a {g(eur(r.importo))}.</> : <>Con questo importo il limite è rispettato.</>}
        </Passaggio>
      )}
      <li className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 border-t border-surface-200 text-gray-700">
        <span>Importo consigliato: <strong className="text-sm text-brand-700 tabular-nums">{eur(r.importo)}</strong></span>
        {r.nuovoPmc != null && <span className="text-gray-500">PMC {prz(r.pmcPrima)} → {prz(r.nuovoPmc)}</span>}
      </li>
    </ol>
  )
}

function TabellaTranche({ piano, config }: { piano: PianoAsset; config: PianoConfig }) {
  const [aperta, setAperta] = useState<number | null>(null)
  const cols = 'grid-cols-[6.5rem_1fr_6.5rem_8.5rem_5rem]'
  return (
    <div>
      <div className={`hidden sm:grid ${cols} gap-x-3 px-3 pb-1.5 text-[11px] uppercase tracking-wide text-gray-400`}>
        <span>Soglia</span><span className="text-right">Prezzo</span><span className="text-right">Importo</span><span className="text-right">Stato</span><span className="text-right">Calcolo</span>
      </div>
      <div className="divide-y divide-surface-100 rounded-xl border border-surface-200 overflow-hidden">
        {piano.righe.map(r => {
          const open = aperta === r.sogliaPct
          return (
            <div key={r.sogliaPct} className={r.ora ? 'bg-brand-50' : r.storica ? 'bg-surface-50/60' : 'bg-white'}>
              <button onClick={() => setAperta(open ? null : r.sogliaPct)} aria-expanded={open}
                className={`w-full text-left px-3 py-2.5 hover:bg-black/[0.02] ${r.storica ? 'text-gray-400' : ''}`}>
                {/* desktop */}
                <div className={`hidden sm:grid ${cols} gap-x-3 items-center`}>
                  <span><span className="text-sm font-semibold text-gray-800 tabular-nums">−{nf(r.sogliaPct)}%</span><span className="block text-[11px] text-gray-400">peso {nf(r.pesoPct, 0)}%</span></span>
                  <span className="text-right text-sm tabular-nums text-gray-600">{prz(r.prezzoRif)}</span>
                  <span className={`text-right tabular-nums num-display ${r.ora ? 'text-base font-bold text-brand-700' : 'text-sm font-semibold text-gray-800'}`}>{eur(r.importo)}</span>
                  <span className="text-right"><StatoChip r={r} /></span>
                  <span className="text-right text-xs font-medium text-brand-700">{open ? 'Chiudi ▴' : 'Come ▾'}</span>
                </div>
                {/* smartphone */}
                <div className="sm:hidden">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-800 tabular-nums text-base">−{nf(r.sogliaPct)}%</span>
                      <StatoChip r={r} />
                    </div>
                    <span className={`tabular-nums num-display ${r.ora ? 'text-lg font-bold text-brand-700' : 'text-base font-semibold text-gray-800'}`}>{eur(r.importo)}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 flex justify-between">
                    <span>peso {nf(r.pesoPct, 0)}% · prezzo {prz(r.prezzoRif)}</span>
                    <span className="font-medium text-brand-700">{open ? 'Chiudi ▴' : 'Come si calcola ▾'}</span>
                  </p>
                </div>
              </button>
              {open && <div className="px-3 pb-3 pt-1"><div className="rounded-lg bg-surface-50 ring-1 ring-surface-200 p-3"><DettaglioCalcolo r={r} quota={piano.quota} config={config} /></div></div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ───────── Struttura a 4 passi ───────── */
const PASSI = [
  { n: 1, vai: 'riserva', icona: '💰', titolo: 'Riserva', testo: 'Liquidità e asset svincolati: il tuo salvadanaio.', box: 'bg-brand-50 ring-brand-100', num: 'bg-brand-600' },
  { n: 2, vai: 'asset', icona: '🫙', titolo: 'Quota', testo: 'Il salvadanaio si divide in un barattolo per ogni asset del piano.', box: 'bg-accent2-50 ring-accent2-100', num: 'bg-accent2-700' },
  { n: 3, vai: 'asset', icona: '🎚️', titolo: 'Tranche', testo: 'Ogni barattolo ha un coperchio per soglia (−5%, −10%…): si apre solo quando il prezzo ci arriva.', box: 'bg-amber-50 ring-amber-100', num: 'bg-amber-600' },
  { n: 4, vai: 'regole', icona: '🎯', titolo: 'Importo', testo: 'Sotto PMC compri di più, sopra il limite PMC ti frena. Mai oltre la quota dell\u2019asset.', box: 'bg-surface-50 ring-surface-200', num: 'bg-gray-800' },
]

function PassiCard({ onVai }: { onVai: (k: string) => void }) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {PASSI.map((p, i) => (
        <button key={p.n} onClick={() => onVai(p.vai)} className={`relative text-left rounded-xl p-4 ring-1 hover:shadow-md transition-shadow ${p.box}`}>
          <div className="flex items-center gap-2.5">
            <span className={`w-8 h-8 rounded-full text-white text-sm font-bold flex items-center justify-center ${p.num}`}>{p.n}</span>
            <span className="text-xl" aria-hidden>{p.icona}</span>
          </div>
          <p className="mt-2.5 text-base font-semibold text-gray-900">{p.titolo}</p>
          <p className="mt-1 text-[13px] leading-snug text-gray-600">{p.testo}</p>
          {i < PASSI.length - 1 && (
            <span aria-hidden className="hidden lg:flex absolute -right-3.5 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full bg-white ring-1 ring-surface-200 text-gray-400 text-sm items-center justify-center">›</span>
          )}
        </button>
      ))}
    </div>
  )
}

function StepBox({ id, numero, colore, titolo, riassunto, aperto, onToggle, children }: {
  id: string; numero: string; colore: string; titolo: string; riassunto: string; aperto: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <section id={id} className="card !p-0 overflow-hidden scroll-mt-24">
      <button onClick={onToggle} aria-expanded={aperto} className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-50/60">
        <span className={`shrink-0 min-w-8 h-8 px-2 rounded-full text-white text-sm font-bold flex items-center justify-center ${colore}`}>{numero}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-gray-900">{titolo}</span>
          <span className="block text-xs text-gray-500 truncate">{riassunto}</span>
        </span>
        <span aria-hidden className={`text-gray-400 transition-transform ${aperto ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {aperto && <div className="px-4 pb-4 pt-3 border-t border-surface-100">{children}</div>}
    </section>
  )
}

export default function PianoAccumulo({
  portafoglio, liquidita, prezziAttuali, behaviorLabel,
  pmcMaxAumento, bonusSottoPmc, moltMax, onSaved, onSimula, onAggiornaPrezzi, loadingPrezzi,
}: Props) {
  const supabase = createClient()
  const profiloDinamico = behaviorLabel === PROFILO_DINAMICO_LABEL

  const [loading, setLoading] = useState(true)
  const [contoFlags, setContoFlags] = useState<ContoFlag[]>([])
  const [savingConto, setSavingConto] = useState<string | null>(null)
  const [aperti, setAperti] = useState<Record<string, boolean>>({ riserva: true, asset: true, regole: false })
  const [assetAperti, setAssetAperti] = useState<string[]>([])
  const [oraAgg, setOraAgg] = useState<Date | null>(null)

  // Regole globali (profilo)
  const [limPmc, setLimPmc] = useState<string>(pmcMaxAumento != null ? String(pmcMaxAumento) : '2')
  const [bonus, setBonus] = useState<string>(String(Math.round((bonusSottoPmc ?? 0.5) * 100)))
  const [mMax, setMMax] = useState<string>(String(moltMax ?? 2))
  const [savingRegole, setSavingRegole] = useState(false)
  const [msgRegole, setMsgRegole] = useState<string | null>(null)

  // Piano (bozza modificabile + copia salvata per sapere se ci sono modifiche)
  const [drafts, setDrafts] = useState<DraftAsset[]>([])
  const [savedSnap, setSavedSnap] = useState<string>('[]')
  const [savedTranche, setSavedTranche] = useState<AccumuloTranche[]>([])
  const [nuovaSoglia, setNuovaSoglia] = useState<Record<string, string>>({})
  const [aggiungi, setAggiungi] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const snapshot = (d: DraftAsset[]) => JSON.stringify(d.map(x => ({ ...x, soglie: x.soglie.map(s => [s.soglia, x.distribuzione === 'manuale' ? s.peso : 0]) })))
  const dirty = snapshot(drafts) !== savedSnap

  const ordineMese = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']
  const ultimiSaldiPerConto = useMemo(() => {
    const perConto: Record<string, { mese: string; saldo: number }> = {}
    liquidita.forEach(l => {
      const att = perConto[l.conto]
      if (!att || ordineMese.indexOf(l.mese) >= ordineMese.indexOf(att.mese)) perConto[l.conto] = { mese: l.mese, saldo: l.saldo }
    })
    return perConto
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liquidita])

  async function caricaPiano() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    const [{ data: cf }, { data: aa }, { data: tt }] = await Promise.all([
      supabase.from('conto_flags').select('*').eq('user_id', user.id),
      supabase.from('accumulo_asset').select('*').eq('user_id', user.id),
      supabase.from('accumulo_tranche').select('*').eq('user_id', user.id),
    ])
    setContoFlags((cf as ContoFlag[]) ?? [])
    const assetRows = ((aa as AccumuloAsset[]) ?? []).filter(a => a.attivo)
    const trancheRows = (tt as AccumuloTranche[]) ?? []
    setSavedTranche(trancheRows)
    const d: DraftAsset[] = assetRows.map(a => ({
      portafoglioId: a.portafoglio_id,
      quotaPct: a.quota_pct != null ? String(a.quota_pct) : '',
      distribuzione: a.distribuzione,
      soglie: trancheRows
        .filter(t => t.portafoglio_id === a.portafoglio_id)
        .sort((x, y) => x.soglia_pct - y.soglia_pct)
        .map(t => ({ soglia: Number(t.soglia_pct), peso: Number(t.peso_pct) })),
    }))
    setDrafts(d)
    setSavedSnap(snapshot(d))
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { caricaPiano() }, [])
  useEffect(() => { if (dirty) setMsg(null) }, [dirty])

  const isContoSvincolato = (conto: string) => contoFlags.find(c => c.conto === conto)?.svincolata ?? false
  async function toggleContoSvincolato(conto: string) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setSavingConto(conto)
    await supabase.from('conto_flags').upsert(
      { user_id: user.id, conto, svincolata: !isContoSvincolato(conto) },
      { onConflict: 'user_id,conto' }
    )
    const { data } = await supabase.from('conto_flags').select('*').eq('user_id', user.id)
    setContoFlags((data as ContoFlag[]) ?? [])
    setSavingConto(null)
  }

  function vai(k: string) {
    setAperti(p => ({ ...p, [k]: true }))
    setTimeout(() => document.getElementById(`pa-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }
  async function aggiornaPrezzi() {
    await onAggiornaPrezzi?.()
    setOraAgg(new Date())
  }

  /* ───────── Riserva ───────── */
  const riservaAsset = portafoglio.filter(a => a.svincolato).reduce((s, a) => s + valoreAttualeAsset(a, prezziAttuali), 0)
  const riservaLiquidita = Object.entries(ultimiSaldiPerConto).filter(([c]) => isContoSvincolato(c)).reduce((s, [, v]) => s + v.saldo, 0)
  const riservaTotale = riservaAsset + riservaLiquidita
  const conti = [...new Set(liquidita.map(l => l.conto))]
  const datiAl = portafoglio.map(a => a.ultimo_aggiornamento_at).filter((x): x is string => !!x).sort().pop() ?? null
  const datiAlTxt = datiAl ? new Date(datiAl).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null
  const fmtData = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null)

  /* ───────── Regole ───────── */
  const config: PianoConfig = {
    bonusSottoPmc: Math.max(0, (num(bonus) ?? 50) / 100),
    moltMax: Math.max(1, num(mMax) ?? 2),
    limitePmc: num(limPmc) != null ? (num(limPmc) as number) / 100 : null,
  }

  async function salvaRegole() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setSavingRegole(true); setMsgRegole(null)
    const { error } = await supabase.from('profili').update({
      pmc_max_aumento_pct: num(limPmc),
      accumulo_bonus_pmc: config.bonusSottoPmc,
      accumulo_molt_max: config.moltMax,
    }).eq('user_id', user.id)
    setSavingRegole(false)
    setMsgRegole(error ? 'Errore nel salvataggio' : '✓ Salvato')
    if (!error) onSaved?.()
  }

  /* ───────── Calcolo piano (dal vivo sulla bozza) ───────── */
  const nelPiano = new Set(drafts.map(d => d.portafoglioId))
  const candidati = portafoglio.filter(a => a.id && !nelPiano.has(a.id) && a.ticker)
  const quote = ripartisciRiserva(riservaTotale, drafts.map(d => ({ id: d.portafoglioId, quotaPct: num(d.quotaPct) })))
  const sommaQuoteManuali = drafts.reduce((s, d) => s + (num(d.quotaPct) ?? 0), 0)

  const calcoli = drafts.map(d => {
    const asset = portafoglio.find(a => a.id === d.portafoglioId)
    if (!asset) return null
    const st = statoAttuale(asset)
    const q = asset.ticker ? prezziAttuali[asset.ticker] : undefined
    const prezzo = q?.price ?? st.prezzoCarico
    const ribasso = ribassoDa(q)
    const pesi = pesiEffettivi(d)
    const sommaPesi = pesi.reduce((s, p) => s + p, 0)
    const idsSalvati = new Map(savedTranche.filter(t => t.portafoglio_id === d.portafoglioId).map(t => [Number(t.soglia_pct), t.id]))
    const piano = calcolaPianoAsset({
      quota: quote.get(d.portafoglioId) ?? 0,
      tranche: d.soglie.map((s, i) => ({ id: idsSalvati.get(s.soglia), sogliaPct: s.soglia, pesoPct: pesi[i] ?? 0 })),
      prezzo, pmc: st.prezzoCarico, quantita: st.quantita, ribasso, config,
    })
    return { d, asset, st, q, prezzo, ribasso, pesi, sommaPesi, piano, haPrezzo: !!q }
  }).filter((x): x is NonNullable<typeof x> => x != null)

  const impegnatoOra = calcoli.reduce((s, c) => s + c.piano.importoOra, 0)
  const errori: string[] = []
  if (sommaQuoteManuali > 100.01) errori.push('Le quote manuali degli asset superano il 100%')
  for (const c of calcoli) {
    const nome = c.asset.nome || c.asset.descrizione || c.asset.ticker
    if (c.d.soglie.length === 0) errori.push(`${nome}: aggiungi almeno una soglia`)
    if (c.d.distribuzione === 'manuale' && Math.abs(c.sommaPesi - 100) > 0.01) errori.push(`${nome}: i pesi delle soglie devono sommare 100% (ora ${nf(c.sommaPesi, 0)}%)`)
  }

  /* ───────── Modifiche alla bozza ───────── */
  const aggiorna = (id: string, fn: (d: DraftAsset) => DraftAsset) =>
    setDrafts(prev => prev.map(d => (d.portafoglioId === id ? fn(d) : d)))

  function aggiungiSoglia(id: string) {
    const v = num(nuovaSoglia[id] ?? '')
    if (v == null || v <= 0 || v >= 100) return
    aggiorna(id, d => d.soglie.some(s => s.soglia === v)
      ? d
      : { ...d, soglie: [...d.soglie, { soglia: v, peso: 0 }].sort((a, b) => a.soglia - b.soglia) })
    setNuovaSoglia(p => ({ ...p, [id]: '' }))
  }

  function cambiaDistribuzione(id: string, tipo: Distribuzione) {
    aggiorna(id, d => {
      if (tipo === 'manuale') {
        const pesi = pesiEffettivi(d)
        return { ...d, distribuzione: tipo, soglie: d.soglie.map((s, i) => ({ ...s, peso: Math.round(pesi[i] ?? 0) })) }
      }
      return { ...d, distribuzione: tipo }
    })
  }

  async function salvaPiano() {
    if (errori.length > 0) { setMsg(errori[0]); return }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setSaving(true); setMsg(null)
    try {
      const idsAttuali = new Set(drafts.map(d => d.portafoglioId))
      // asset tolti dal piano
      const { data: esistenti } = await supabase.from('accumulo_asset').select('portafoglio_id').eq('user_id', user.id)
      const daRimuovere = ((esistenti as { portafoglio_id: string }[]) ?? []).map(e => e.portafoglio_id).filter(id => !idsAttuali.has(id))
      if (daRimuovere.length > 0) {
        await supabase.from('accumulo_tranche').delete().eq('user_id', user.id).in('portafoglio_id', daRimuovere)
        await supabase.from('accumulo_asset').delete().eq('user_id', user.id).in('portafoglio_id', daRimuovere)
      }
      for (const c of calcoli) {
        const { error: e1 } = await supabase.from('accumulo_asset').upsert({
          user_id: user.id, portafoglio_id: c.d.portafoglioId, attivo: true,
          quota_pct: num(c.d.quotaPct), distribuzione: c.d.distribuzione,
        }, { onConflict: 'portafoglio_id' })
        if (e1) throw e1
        // le soglie già note mantengono lo stato (evita alert doppi); le nuove partono già "scattate" se il ribasso le ha superate
        const prec = new Map(savedTranche.filter(t => t.portafoglio_id === c.d.portafoglioId).map(t => [Number(t.soglia_pct), t]))
        const massimoOra = c.ribasso > 0 && c.ribasso < 1 ? c.prezzo / (1 - c.ribasso) : c.prezzo
        const righe = c.d.soglie.map((s, i) => {
          const p0 = prec.get(s.soglia)
          const giaSuperata = c.ribasso * 100 >= s.soglia
          return {
            user_id: user.id, portafoglio_id: c.d.portafoglioId, soglia_pct: s.soglia, peso_pct: c.pesi[i] ?? 0,
            in_breach: p0?.in_breach ?? giaSuperata,
            ultima_notifica_at: p0?.ultima_notifica_at ?? null,
            // la memoria degli avvisi si conserva; una soglia già superata alla creazione parte con il massimo attuale come riferimento
            attivazioni: p0?.attivazioni ?? 0,
            massimo_ultimo_avviso: p0 ? (p0.massimo_ultimo_avviso ?? null) : (giaSuperata ? massimoOra : null),
            prezzo_ultimo_avviso: p0 ? (p0.prezzo_ultimo_avviso ?? null) : (giaSuperata ? c.prezzo : null),
          }
        })
        const { error: e2 } = await supabase.from('accumulo_tranche').delete().eq('user_id', user.id).eq('portafoglio_id', c.d.portafoglioId)
        if (e2) throw e2
        if (righe.length > 0) {
          const { error: e3 } = await supabase.from('accumulo_tranche').insert(righe)
          if (e3) throw e3
        }
      }
      await caricaPiano()
      setMsg('✓ Piano salvato: alert e mail useranno questi importi')
      onSaved?.()
    } catch {
      setMsg('Errore nel salvataggio del piano (hai eseguito la migrazione SQL?)')
    }
    setSaving(false)
  }

  if (loading) return null

  const statoPrezzi = Object.keys(prezziAttuali).length > 0
    ? (oraAgg ? `Prezzi aggiornati alle ${oraAgg.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}` : 'Prezzi caricati')
    : 'Prezzi non ancora caricati'

  return (
    <div className="space-y-4">
      {/* ───── Intestazione + come funziona ───── */}
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-base font-semibold text-gray-900">Piano di accumulo</p>
              <InfoAccumuloModal />
            </div>
            <p className="text-sm text-gray-500 mt-0.5">Decidi tu quanto investire a ogni ribasso. Gli importi sono gli stessi che trovi in alert e mail.</p>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-xs text-gray-400">{statoPrezzi}</span>
            <button onClick={aggiornaPrezzi} disabled={loadingPrezzi} className="btn-secondary text-xs px-3 py-1.5">
              {loadingPrezzi ? '⟳ Aggiorno…' : '↻ Aggiorna prezzi'}
            </button>
          </div>
        </div>

        <p className="mt-5 mb-2.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Come funziona, in 4 passi</p>
        <PassiCard onVai={vai} />

        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-brand-700 select-none">Approfondimenti: soglie in Anagrafica e riarmo</summary>
          <div className="mt-2 space-y-2 text-xs text-gray-600 leading-relaxed">
            <p><strong className="text-gray-800">E le soglie in Anagrafica?</strong> Per gli asset del piano gli importi dipendono solo dal ribasso <em>dal massimo</em>: le tranche sostituiscono la soglia &ldquo;Max %&rdquo;. La soglia <em>mensile</em> resta un semplice avviso, non genera importi.</p>
            <p><strong className="text-gray-800">Riarmo.</strong> Una tranche suona di nuovo solo dopo che il prezzo è risalito sopra la soglia e poi riscende. L&apos;alert indica l&apos;attivazione (#2, #3…), se c&apos;è stato un nuovo massimo e la data dei dati: l&apos;app non sa se hai già comprato, quindi controlla prima di investire.</p>
          </div>
        </details>
      </div>

      {!profiloDinamico && (
        <div className="rounded-lg bg-amber-50 ring-1 ring-amber-100 p-3 text-xs text-amber-700">
          Il profilo non è su &quot;accumula sui crolli&quot;: puoi configurare e simulare il piano, ma alert e mail non indicheranno importi.
        </div>
      )}

      {/* ───── Passo 1: Riserva ───── */}
      <StepBox id="pa-riserva" numero="1" colore="bg-brand-600" titolo="Riserva"
        riassunto={`${eur(riservaTotale)} disponibili · ${eur(riservaLiquidita)} liquidità + ${eur(riservaAsset)} asset`}
        aperto={aperti.riserva} onToggle={() => setAperti(p => ({ ...p, riserva: !p.riserva }))}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { l: 'Riserva disponibile', v: eur(riservaTotale), s: `${eur(riservaLiquidita)} liquidità · ${eur(riservaAsset)} asset${datiAlTxt ? ` · dati al ${datiAlTxt}` : ''}` },
            { l: 'Asset nel piano', v: String(drafts.length), s: drafts.length > 0 ? `quota media ${eur(riservaTotale / drafts.length)}` : 'aggiungine uno nel passo 2-3' },
            { l: 'Da investire ora', v: eur(impegnatoOra), s: 'somma delle tranche scattate', evidenza: true },
            { l: 'Riserva residua', v: eur(Math.max(0, riservaTotale - impegnatoOra)), s: 'dopo le tranche di adesso' },
          ].map(k => (
            <div key={k.l} className={`rounded-xl p-3 ring-1 ${k.evidenza ? 'bg-brand-50 ring-brand-100' : 'bg-surface-50 ring-surface-200'}`}>
              <p className="text-xs text-gray-500">{k.l}</p>
              <p className={`num-display tabular-nums font-bold leading-tight mt-0.5 ${k.evidenza ? 'text-2xl text-brand-700' : 'text-xl text-gray-900'}`}>{k.v}</p>
              <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{k.s}</p>
            </div>
          ))}
        </div>
        {conti.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-gray-600 mb-1.5">Conti liquidità <span className="font-normal text-gray-400">· tocca per includerli o escluderli dalla riserva</span></p>
            <div className="flex flex-wrap gap-2">
              {conti.map(conto => (
                <button key={conto} onClick={() => toggleContoSvincolato(conto)} disabled={savingConto === conto}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium ${isContoSvincolato(conto) ? 'bg-brand-100 text-brand-700 ring-1 ring-brand-200' : 'bg-gray-100 text-gray-500'}`}>
                  {isContoSvincolato(conto) ? '✓ ' : ''}{conto} · {isContoSvincolato(conto) ? 'Svincolata' : 'Vincolata'}
                </button>
              ))}
            </div>
          </div>
        )}
      </StepBox>

      {/* ───── Passi 2-3: Asset, quote e tranche ───── */}
      <StepBox id="pa-asset" numero="2·3" colore="bg-accent2-700" titolo="Asset, quote e tranche"
        riassunto={drafts.length > 0 ? `${drafts.length} asset nel piano · ${eur(impegnatoOra)} da investire ora` : 'Nessun asset nel piano: aggiungine uno'}
        aperto={aperti.asset} onToggle={() => setAperti(p => ({ ...p, asset: !p.asset }))}>
        <div className="space-y-2.5">
          {calcoli.length === 0 && (
            <div className="rounded-xl bg-surface-50 ring-1 ring-surface-200 text-center py-8">
              <p className="text-sm font-medium text-gray-700">Nessun asset nel piano</p>
              <p className="text-xs text-gray-400 mt-1">Aggiungi gli asset su cui vuoi accumulare durante i crolli.</p>
            </div>
          )}

          {calcoli.map(c => {
            const id = c.d.portafoglioId
            const nome = c.asset.nome || c.asset.descrizione || c.asset.ticker
            const pnl = c.st.prezzoCarico > 0 ? (c.prezzo / c.st.prezzoCarico - 1) * 100 : 0
            const quota = quote.get(id) ?? 0
            const open = assetAperti.includes(id)
            const ora = c.piano.importoOra > 0
            const prossima = c.piano.righe.find(r => !r.scattata)
            return (
              <div key={id} className={`rounded-xl ring-1 overflow-hidden ${ora ? 'ring-brand-200 bg-brand-50/40' : 'ring-surface-200 bg-white'}`}>
                {/* riga riassunto (da chiuso) */}
                <button onClick={() => setAssetAperti(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))} aria-expanded={open}
                  className="w-full text-left px-3 sm:px-4 py-3 flex items-center gap-3 hover:bg-black/[0.02]">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="text-sm font-semibold text-gray-900 truncate">{nome}</p>
                      <span className="text-xs text-gray-400 shrink-0">{c.asset.ticker}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {c.haPrezzo ? `${prz(c.prezzo)} · −${nf(c.ribasso * 100, 1)}% dal massimo` : 'prezzo non caricato'} · quota {eur(quota)}
                    </p>
                    <div className="flex items-center gap-1 mt-1.5" aria-label="Soglie del piano">
                      {c.piano.righe.map(r => (
                        <span key={r.sogliaPct} title={`−${nf(r.sogliaPct)}%`}
                          className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded-full ${r.scattata ? 'bg-brand-600 text-white' : 'bg-surface-100 text-gray-400'}`}>−{nf(r.sogliaPct)}%</span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {ora ? (
                      <>
                        <p className="text-[11px] text-gray-400 leading-none">da investire ora</p>
                        <p className="text-lg font-bold text-brand-700 tabular-nums num-display">{eur(c.piano.importoOra)}</p>
                      </>
                    ) : (
                      <>
                        <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-accent2-50 text-accent2-700 ring-1 ring-accent2-100">In attesa</span>
                        {prossima && <p className="text-[11px] text-gray-400 mt-1">prossima −{nf(prossima.sogliaPct)}%</p>}
                      </>
                    )}
                  </div>
                  <span aria-hidden className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
                </button>

                {open && (
                  <div className="border-t border-surface-200 bg-white px-3 sm:px-4 py-4 space-y-5">
                    <div className="grid lg:grid-cols-2 gap-5">
                      {/* configurazione */}
                      <div className="space-y-4">
                        <div className="grid grid-cols-3 gap-2 text-center">
                          {[
                            { l: 'Prezzo', v: c.haPrezzo ? prz(c.prezzo) : '–' },
                            { l: 'PMC', v: prz(c.st.prezzoCarico), s: c.haPrezzo ? `${pnl >= 0 ? '+' : '−'}${nf(Math.abs(pnl), 1)}%` : undefined, rosso: pnl < 0 },
                            { l: 'Dal massimo', v: c.haPrezzo ? `−${nf(c.ribasso * 100, 1)}%` : '–' },
                          ].map(k => (
                            <div key={k.l} className="rounded-lg bg-surface-50 py-2">
                              <p className="text-[11px] text-gray-400">{k.l}</p>
                              <p className="text-sm font-semibold text-gray-800 tabular-nums">{k.v}</p>
                              {k.s && <p className={`text-[11px] tabular-nums ${k.rosso ? 'text-red-600' : 'text-brand-700'}`}>{k.s}</p>}
                            </div>
                          ))}
                        </div>
                        {!c.haPrezzo && <p className="text-xs text-amber-700">Prezzi non caricati: premi &quot;Aggiorna prezzi&quot; qui sopra.</p>}

                        <div className="grid grid-cols-2 gap-3">
                          <label className="text-xs text-gray-500">
                            Quota di riserva (%)
                            <input type="number" inputMode="decimal" min={0} max={100} step="1" placeholder="uguale"
                              value={c.d.quotaPct} onChange={e => aggiorna(id, d => ({ ...d, quotaPct: e.target.value }))} className="input mt-1 !py-1.5" />
                            <span className="block text-[11px] text-gray-400 mt-0.5">= {eur(quota)}{c.d.quotaPct.trim() === '' ? ' (parti uguali)' : ''}</span>
                          </label>
                          <label className="text-xs text-gray-500">
                            Pesi tra le soglie
                            <select value={c.d.distribuzione} onChange={e => cambiaDistribuzione(id, e.target.value as Distribuzione)} className="input mt-1 !py-1.5">
                              <option value="uguale">Uguali</option>
                              <option value="crescente">Crescenti (più a fondo, più compri)</option>
                              <option value="manuale">Manuali</option>
                            </select>
                          </label>
                        </div>

                        <div>
                          <p className="text-xs text-gray-500 mb-1.5">Soglie di ribasso dal massimo</p>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {c.d.soglie.map((s, i) => (
                              <span key={s.soglia} className="inline-flex items-center gap-1 rounded-full bg-surface-50 ring-1 ring-surface-200 pl-2.5 pr-1.5 py-0.5 text-xs">
                                <span className="font-semibold text-gray-700 tabular-nums">−{nf(s.soglia)}%</span>
                                {c.d.distribuzione === 'manuale' && (
                                  <span className="inline-flex items-center">
                                    <input type="number" inputMode="decimal" min={0} max={100} value={s.peso}
                                      onChange={e => aggiorna(id, d => ({ ...d, soglie: d.soglie.map((x, j) => (j === i ? { ...x, peso: Number(e.target.value) } : x)) }))}
                                      className="w-12 rounded border border-surface-200 px-1 py-0.5 text-[11px] text-right" aria-label={`Peso soglia ${s.soglia}%`} />
                                    <span className="text-[10px] text-gray-400 ml-0.5">%</span>
                                  </span>
                                )}
                                <button onClick={() => aggiorna(id, d => ({ ...d, soglie: d.soglie.filter((_, j) => j !== i) }))}
                                  className="text-gray-300 hover:text-red-500 leading-none px-0.5" aria-label={`Togli soglia ${s.soglia}%`}>✕</button>
                              </span>
                            ))}
                            <span className="inline-flex items-center gap-1">
                              <input type="number" inputMode="decimal" min={1} max={99} placeholder="+ %" value={nuovaSoglia[id] ?? ''}
                                onChange={e => setNuovaSoglia(p => ({ ...p, [id]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') aggiungiSoglia(id) }}
                                className="w-16 rounded-full border border-surface-200 px-2.5 py-0.5 text-xs" />
                              <button onClick={() => aggiungiSoglia(id)} className="text-xs font-medium text-brand-700 hover:underline">Aggiungi</button>
                            </span>
                          </div>
                          {c.d.distribuzione === 'manuale' && (
                            <p className={`text-[11px] mt-1 ${Math.abs(c.sommaPesi - 100) > 0.01 ? 'text-red-600' : 'text-gray-400'}`}>Somma pesi {nf(c.sommaPesi, 0)}% (deve fare 100%)</p>
                          )}
                        </div>
                      </div>

                      {/* barre */}
                      {c.piano.righe.length > 0 && (
                        <div className="space-y-3">
                          <div>
                            <p className="text-xs text-gray-500">Dove sei rispetto alle soglie</p>
                            <BarraSoglie righe={c.piano.righe} ribasso={c.ribasso} />
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 mb-1.5">Come si usa la quota</p>
                            <BarraCapitale piano={c.piano} />
                          </div>
                        </div>
                      )}
                    </div>

                    {c.piano.righe.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-gray-600 mb-1.5">Importi consigliati lungo la discesa <span className="font-normal text-gray-400">· tocca una riga per vedere il calcolo</span></p>
                        <TabellaTranche piano={c.piano} config={config} />
                        {(() => {
                          const av = savedTranche
                            .filter(t => t.portafoglio_id === id && (t.attivazioni ?? 0) > 0)
                            .sort((x, y) => x.soglia_pct - y.soglia_pct)
                          if (av.length === 0) return null
                          return (
                            <p className="mt-2 text-xs text-gray-500 leading-snug">
                              <span className="font-medium text-gray-600">Avvisi già inviati:</span>{' '}
                              {av.map(t => `−${nf(Number(t.soglia_pct))}%: ${t.attivazioni}× (ultimo ${fmtData(t.ultima_notifica_at) ?? '–'})`).join(' · ')}
                            </p>
                          )
                        })()}
                        <p className="text-[11px] text-gray-400 leading-snug mt-2">Le soglie in attesa usano il prezzo che avrebbe l&apos;asset in quel punto, ipotizzando di aver comprato le tranche precedenti.</p>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-surface-100">
                      <button onClick={() => setDrafts(p => p.filter(x => x.portafoglioId !== id))} className="text-xs text-gray-400 hover:text-red-600">Rimuovi dal piano ✕</button>
                      {onSimula && c.piano.importoOra > 0 && (
                        <button onClick={() => onSimula(id, c.piano.importoOra)} className="text-xs font-medium text-brand-700 hover:underline">Simula l&apos;acquisto di adesso →</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* aggiungi asset */}
          <div className="rounded-xl border border-dashed border-surface-300 p-3 flex flex-wrap items-center gap-2">
            <select value={aggiungi} onChange={e => setAggiungi(e.target.value)} className="input !w-auto min-w-[12rem] !py-1.5 text-xs">
              <option value="">Aggiungi un asset al piano…</option>
              {candidati.map(a => <option key={a.id} value={a.id}>{a.nome || a.descrizione || a.ticker} ({a.ticker})</option>)}
            </select>
            <button disabled={!aggiungi} onClick={() => { setDrafts(p => [...p, nuovaDraft(aggiungi)]); setAssetAperti(p => [...p, aggiungi]); setAggiungi('') }} className="btn-secondary !py-1.5 !px-3 text-xs disabled:opacity-40">
              + Aggiungi
            </button>
            <span className="text-xs text-gray-400">Parte con soglie −5/−10/−15/−20% e pesi crescenti: modificali come preferisci.</span>
          </div>
        </div>
      </StepBox>

      {/* ───── Passo 4: Regole e importi ───── */}
      <StepBox id="pa-regole" numero="4" colore="bg-gray-800" titolo="Regole e importi"
        riassunto={`Limite PMC ${limPmc.trim() === '' ? 'nessuno' : `+${limPmc}%`} · bonus ${bonus}% ogni −10% · max ×${mMax}`}
        aperto={aperti.regole} onToggle={() => setAperti(p => ({ ...p, regole: !p.regole }))}>
        <p className="text-xs text-gray-500 mb-3">Queste regole valgono per tutti gli asset del piano e decidono quanto comprare a ogni soglia.</p>
        <div className="grid sm:grid-cols-3 gap-4">
          <label className="block text-xs text-gray-600">
            <span className="font-medium text-gray-800">Limite aumento PMC (%)</span> <span className="text-gray-400">· sopra PMC</span>
            <input type="number" inputMode="decimal" min={0} step="0.5" value={limPmc} onChange={e => setLimPmc(e.target.value)} className="input mt-1 !py-1.5" />
            <span className="block text-[11px] text-gray-400 mt-1">Il nuovo PMC non può salire oltre questa %. Vuoto = nessun limite.</span>
          </label>
          <label className="block text-xs text-gray-600">
            <span className="font-medium text-gray-800">Bonus ogni −10% sotto PMC (%)</span>
            <input type="number" inputMode="decimal" min={0} step="5" value={bonus} onChange={e => setBonus(e.target.value)} className="input mt-1 !py-1.5" />
            <span className="block text-[11px] text-gray-400 mt-1">50 = compri +50% in più ogni −10% sotto il tuo PMC.</span>
          </label>
          <label className="block text-xs text-gray-600">
            <span className="font-medium text-gray-800">Moltiplicatore massimo (×)</span>
            <input type="number" inputMode="decimal" min={1} step="0.5" value={mMax} onChange={e => setMMax(e.target.value)} className="input mt-1 !py-1.5" />
            <span className="block text-[11px] text-gray-400 mt-1">Tetto al bonus: 2 = al massimo il doppio della tranche.</span>
          </label>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button onClick={salvaRegole} disabled={savingRegole} className="btn-primary !py-1.5 !px-3 text-xs">{savingRegole ? 'Salvo…' : 'Salva regole'}</button>
          {msgRegole && <span className="text-xs text-gray-500">{msgRegole}</span>}
        </div>

        {calcoli.length > 0 && (
          <div className="mt-5 pt-4 border-t border-surface-100">
            <p className="text-xs font-medium text-gray-600 mb-2">Importi consigliati adesso</p>
            <div className="divide-y divide-surface-100 rounded-xl border border-surface-200 overflow-hidden">
              {calcoli.map(c => (
                <div key={c.d.portafoglioId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="truncate text-gray-700">{c.asset.nome || c.asset.descrizione || c.asset.ticker}</span>
                  {c.piano.importoOra > 0
                    ? <span className="font-bold text-brand-700 tabular-nums">{eur(c.piano.importoOra)}</span>
                    : <span className="text-xs text-gray-400">nessuna soglia scattata</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </StepBox>

      {/* ───── Barra di salvataggio ───── */}
      {(dirty || msg) && (
        <div className="sticky bottom-3 z-20">
          <div className="rounded-xl bg-white shadow-lg ring-1 ring-surface-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <p className={`text-xs ${errori.length > 0 ? 'text-red-600' : 'text-gray-600'}`}>
              {errori.length > 0 ? errori[0] : msg ?? 'Modifiche non salvate: alert e mail usano ancora il piano salvato.'}
            </p>
            {dirty && (
              <div className="flex items-center gap-2">
                <button onClick={() => caricaPiano()} className="btn-secondary !py-1.5 !px-3 text-xs">Annulla</button>
                <button onClick={salvaPiano} disabled={saving || errori.length > 0} className="btn-primary !py-1.5 !px-3 text-xs">{saving ? 'Salvo…' : 'Salva piano'}</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
