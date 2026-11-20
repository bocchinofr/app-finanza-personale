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

/* ───────── Riga tranche (tabella su desktop, card su smartphone) ───────── */
function StatoChip({ r }: { r: RigaPiano }) {
  if (r.ora) return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand-600 text-white whitespace-nowrap">Da investire ora</span>
  if (r.storica) return <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-surface-100 text-gray-500 whitespace-nowrap">Già sbloccata</span>
  return <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-accent2-50 text-accent2-700 ring-1 ring-accent2-100 whitespace-nowrap">In attesa</span>
}

function Motivo({ r }: { r: RigaPiano }) {
  if (r.storica) return <span className="text-gray-400">già gestita in precedenza</span>
  const parti: string[] = []
  if (r.sottoPmc) parti.push(`sotto PMC → ×${nf(r.moltiplicatore, 2)}`)
  else parti.push('sopra PMC → ×1')
  if (r.limitataDaPmc) parti.push('ridotta dal limite PMC')
  if (r.limitataDaQuota) parti.push('tetto = quota asset')
  return <span>{parti.join(' · ')}</span>
}

function TabellaTranche({ piano }: { piano: PianoAsset }) {
  return (
    <div>
      {/* intestazione solo da tablet in su */}
      <div className="hidden sm:grid grid-cols-[4.5rem_4rem_6rem_1fr_6rem_7.5rem] gap-x-3 px-2 pb-1.5 text-[10px] uppercase tracking-wide text-gray-400">
        <span>Soglia</span><span className="text-right">Peso</span><span className="text-right">Prezzo</span>
        <span>Come si calcola</span><span className="text-right">Importo</span><span className="text-right">Stato</span>
      </div>
      <div className="divide-y divide-surface-100 rounded-lg border border-surface-200 overflow-hidden">
        {piano.righe.map(r => (
          <div key={r.sogliaPct} className={`px-2 py-2 text-xs ${r.ora ? 'bg-brand-50' : r.storica ? 'bg-surface-50/60 text-gray-400' : 'bg-white'}`}>
            {/* desktop */}
            <div className="hidden sm:grid grid-cols-[4.5rem_4rem_6rem_1fr_6rem_7.5rem] gap-x-3 items-center">
              <span className="font-semibold text-gray-800 tabular-nums">−{nf(r.sogliaPct)}%</span>
              <span className="text-right tabular-nums text-gray-500">{nf(r.pesoPct, 0)}%</span>
              <span className="text-right tabular-nums text-gray-600">{prz(r.prezzoRif)}</span>
              <span className="text-gray-500 leading-snug">
                {!r.storica && <>{eur(r.base)} base · </>}<Motivo r={r} />
                {r.nuovoPmc != null && !r.storica && <span className="text-gray-400"> · PMC {prz(r.pmcPrima)} → {prz(r.nuovoPmc)}</span>}
              </span>
              <span className={`text-right tabular-nums num-display ${r.ora ? 'text-base font-bold text-brand-700' : 'text-sm font-semibold text-gray-800'}`}>{eur(r.importo)}</span>
              <span className="text-right"><StatoChip r={r} /></span>
            </div>
            {/* smartphone */}
            <div className="sm:hidden">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-800 tabular-nums text-sm">−{nf(r.sogliaPct)}%</span>
                  <StatoChip r={r} />
                </div>
                <span className={`tabular-nums num-display ${r.ora ? 'text-lg font-bold text-brand-700' : 'text-base font-semibold text-gray-800'}`}>{eur(r.importo)}</span>
              </div>
              <p className="text-[11px] text-gray-500 mt-1 leading-snug">
                Peso {nf(r.pesoPct, 0)}%{!r.storica && <> · prezzo {prz(r.prezzoRif)} · <Motivo r={r} /></>}
                {r.nuovoPmc != null && !r.storica && <> · PMC {prz(r.pmcPrima)} → {prz(r.nuovoPmc)}</>}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PianoAccumulo({
  portafoglio, liquidita, prezziAttuali, behaviorLabel,
  pmcMaxAumento, bonusSottoPmc, moltMax, onSaved, onSimula,
}: Props) {
  const supabase = createClient()
  const profiloDinamico = behaviorLabel === PROFILO_DINAMICO_LABEL

  const [loading, setLoading] = useState(true)
  const [contoFlags, setContoFlags] = useState<ContoFlag[]>([])
  const [savingConto, setSavingConto] = useState<string | null>(null)
  const [showConti, setShowConti] = useState(false)

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

  return (
    <div className="space-y-4">
      {/* ───── Intestazione + info box ───── */}
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-900">Piano di accumulo</p>
              <InfoAccumuloModal />
            </div>
            <p className="text-xs text-gray-500 mt-0.5">Decidi tu quanto investire a ogni ribasso. Gli importi qui sotto sono gli stessi che trovi in alert e mail.</p>
          </div>
          {conti.length > 0 && (
            <button onClick={() => setShowConti(v => !v)} className="text-xs font-medium text-brand-700 hover:underline">
              {showConti ? 'Chiudi conti' : 'Conti liquidità'}
            </button>
          )}
        </div>

        <div className="mt-3 rounded-lg bg-accent2-50 ring-1 ring-accent2-100 p-3">
          <p className="text-xs font-semibold text-accent2-700 mb-1.5">Come funziona, in 4 passi</p>
          <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-1.5 text-[11px] text-gray-600 leading-snug list-decimal pl-4">
            <li><strong className="text-gray-800">Riserva</strong>: liquidità e asset svincolati, il tuo salvadanaio.</li>
            <li><strong className="text-gray-800">Quota</strong>: il salvadanaio si divide in un barattolo per ogni asset del piano.</li>
            <li><strong className="text-gray-800">Tranche</strong>: ogni barattolo ha un coperchio per soglia (−5%, −10%…). Si apre solo quando il prezzo ci arriva.</li>
            <li><strong className="text-gray-800">Importo</strong>: sotto PMC compri di più, sopra PMC il limite PMC ti frena. Mai oltre la quota dell&apos;asset.</li>
          </ol>
          <p className="mt-2 pt-2 border-t border-accent2-100 text-[11px] text-gray-600 leading-snug">
            <strong className="text-gray-800">E le soglie in Anagrafica?</strong> Per gli asset del piano gli importi dipendono solo dal ribasso <em>dal massimo</em>, e sono le tranche a sostituire la soglia &ldquo;Max %&rdquo;.
            La soglia <em>mensile</em> resta un semplice avviso: ti dice dove sei rispetto al massimo e a quale tranche, ma non genera importi.
          </p>
          <p className="mt-2 text-[11px] text-gray-600 leading-snug">
            <strong className="text-gray-800">Riarmo.</strong> Una tranche suona di nuovo solo dopo che il prezzo è uscito dalla sua zona (risale sopra la soglia) e poi riscende. In quel caso l&apos;alert ti segnala che il livello è già scattato
            (attivazione #2, #3…), se dall&apos;ultimo avviso c&apos;è stato un nuovo massimo e a quale data sono aggiornati i tuoi dati: l&apos;app non sa se hai già comprato, quindi controlla prima di investire.
          </p>
        </div>

        {showConti && (
          <div className="mt-3 flex flex-wrap gap-2">
            {conti.map(conto => (
              <button key={conto} onClick={() => toggleContoSvincolato(conto)} disabled={savingConto === conto}
                className={`px-2 py-1 rounded-full text-xs font-medium ${isContoSvincolato(conto) ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-500'}`}>
                {conto} · {isContoSvincolato(conto) ? 'Svincolata' : 'Vincolata'}
              </button>
            ))}
          </div>
        )}
      </div>

      {!profiloDinamico && (
        <div className="rounded-lg bg-amber-50 ring-1 ring-amber-100 p-3 text-xs text-amber-700">
          Il profilo non è su &quot;accumula sui crolli&quot;: puoi configurare e simulare il piano, ma alert e mail non indicheranno importi.
        </div>
      )}

      {/* ───── KPI ───── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { l: 'Riserva disponibile', v: eur(riservaTotale), s: `${eur(riservaLiquidita)} liquidità · ${eur(riservaAsset)} asset${datiAlTxt ? ` · dati al ${datiAlTxt}` : ''}` },
          { l: 'Asset nel piano', v: String(drafts.length), s: drafts.length > 0 ? `quota media ${eur(riservaTotale / drafts.length)}` : 'aggiungine uno sotto' },
          { l: 'Da investire ora', v: eur(impegnatoOra), s: 'somma delle tranche scattate', evidenza: true },
          { l: 'Riserva residua', v: eur(Math.max(0, riservaTotale - impegnatoOra)), s: 'dopo le tranche di adesso' },
        ].map(k => (
          <div key={k.l} className="card py-3">
            <p className="text-[11px] text-gray-500">{k.l}</p>
            <p className={`num-display tabular-nums font-bold leading-tight mt-0.5 ${k.evidenza ? 'text-2xl text-brand-700' : 'text-xl text-gray-900'}`}>{k.v}</p>
            <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{k.s}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-[18rem_1fr] gap-4 items-start">
        {/* ───── Regole globali ───── */}
        <div className="card lg:sticky lg:top-20">
          <p className="text-sm font-semibold text-gray-800">Le tue regole</p>
          <p className="text-[11px] text-gray-400 mb-3">Valgono per tutti gli asset del piano.</p>
          <div className="space-y-3">
            <label className="block text-[11px] text-gray-500">
              Limite aumento PMC (%) <span className="text-gray-400">· sopra PMC</span>
              <input type="number" inputMode="decimal" min={0} step="0.5" value={limPmc} onChange={e => setLimPmc(e.target.value)} className="input mt-1 !py-1.5" />
              <span className="block text-[10px] text-gray-400 mt-0.5">Il nuovo PMC non può salire oltre questa %. Vuoto = nessun limite.</span>
            </label>
            <label className="block text-[11px] text-gray-500">
              Bonus ogni −10% sotto PMC (%)
              <input type="number" inputMode="decimal" min={0} step="5" value={bonus} onChange={e => setBonus(e.target.value)} className="input mt-1 !py-1.5" />
              <span className="block text-[10px] text-gray-400 mt-0.5">50 = compri +50% in più ogni −10% sotto il tuo PMC.</span>
            </label>
            <label className="block text-[11px] text-gray-500">
              Moltiplicatore massimo (×)
              <input type="number" inputMode="decimal" min={1} step="0.5" value={mMax} onChange={e => setMMax(e.target.value)} className="input mt-1 !py-1.5" />
              <span className="block text-[10px] text-gray-400 mt-0.5">Tetto al bonus: 2 = al massimo il doppio della tranche.</span>
            </label>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <button onClick={salvaRegole} disabled={savingRegole} className="btn-primary !py-1.5 !px-3 text-xs">{savingRegole ? 'Salvo…' : 'Salva regole'}</button>
            {msgRegole && <span className="text-[11px] text-gray-500">{msgRegole}</span>}
          </div>
        </div>

        {/* ───── Asset del piano ───── */}
        <div className="space-y-4 min-w-0">
          {calcoli.length === 0 && (
            <div className="card text-center py-8">
              <p className="text-sm font-medium text-gray-700">Nessun asset nel piano</p>
              <p className="text-xs text-gray-400 mt-1">Aggiungi gli asset su cui vuoi accumulare durante i crolli.</p>
            </div>
          )}

          <div className="grid xl:grid-cols-2 gap-4">
            {calcoli.map(c => {
              const id = c.d.portafoglioId
              const nome = c.asset.nome || c.asset.descrizione || c.asset.ticker
              const pnl = c.st.prezzoCarico > 0 ? (c.prezzo / c.st.prezzoCarico - 1) * 100 : 0
              const quota = quote.get(id) ?? 0
              return (
                <section key={id} className="card !p-0 overflow-hidden xl:[&:nth-child(odd):last-child]:col-span-2">
                  {/* testata asset */}
                  <div className="flex items-start justify-between gap-3 px-4 pt-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 leading-tight truncate">{nome}</p>
                      <p className="text-[11px] text-gray-400">{c.asset.ticker}</p>
                    </div>
                    <button onClick={() => setDrafts(p => p.filter(x => x.portafoglioId !== id))}
                      className="text-[11px] text-gray-400 hover:text-red-600 shrink-0" title="Togli dal piano">Rimuovi ✕</button>
                  </div>

                  <div className="grid grid-cols-3 gap-2 px-4 mt-3 text-center">
                    {[
                      { l: 'Prezzo', v: c.haPrezzo ? prz(c.prezzo) : '–' },
                      { l: 'PMC', v: prz(c.st.prezzoCarico), s: c.haPrezzo ? `${pnl >= 0 ? '+' : '−'}${nf(Math.abs(pnl), 1)}%` : undefined, rosso: pnl < 0 },
                      { l: 'Dal massimo', v: c.haPrezzo ? `−${nf(c.ribasso * 100, 1)}%` : '–' },
                    ].map(k => (
                      <div key={k.l} className="rounded-lg bg-surface-50 py-1.5">
                        <p className="text-[10px] text-gray-400">{k.l}</p>
                        <p className="text-xs font-semibold text-gray-800 tabular-nums">{k.v}</p>
                        {k.s && <p className={`text-[10px] tabular-nums ${k.rosso ? 'text-red-600' : 'text-brand-700'}`}>{k.s}</p>}
                      </div>
                    ))}
                  </div>
                  {!c.haPrezzo && <p className="px-4 mt-2 text-[11px] text-amber-700">Prezzi non caricati: premi &quot;Aggiorna prezzi&quot; in Anagrafica per vedere a che punto sei.</p>}

                  {/* quota + distribuzione */}
                  <div className="grid grid-cols-2 gap-3 px-4 mt-3">
                    <label className="text-[11px] text-gray-500">
                      Quota di riserva (%)
                      <input type="number" inputMode="decimal" min={0} max={100} step="1" placeholder="uguale"
                        value={c.d.quotaPct} onChange={e => aggiorna(id, d => ({ ...d, quotaPct: e.target.value }))} className="input mt-1 !py-1.5" />
                      <span className="block text-[10px] text-gray-400 mt-0.5">= {eur(quota)}{c.d.quotaPct.trim() === '' ? ' (parti uguali)' : ''}</span>
                    </label>
                    <label className="text-[11px] text-gray-500">
                      Pesi tra le soglie
                      <select value={c.d.distribuzione} onChange={e => cambiaDistribuzione(id, e.target.value as Distribuzione)} className="input mt-1 !py-1.5">
                        <option value="uguale">Uguali</option>
                        <option value="crescente">Crescenti (più a fondo, più compri)</option>
                        <option value="manuale">Manuali</option>
                      </select>
                    </label>
                  </div>

                  {/* soglie */}
                  <div className="px-4 mt-3">
                    <p className="text-[11px] text-gray-500 mb-1.5">Soglie di ribasso dal massimo</p>
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
                      <p className={`text-[10px] mt-1 ${Math.abs(c.sommaPesi - 100) > 0.01 ? 'text-red-600' : 'text-gray-400'}`}>Somma pesi {nf(c.sommaPesi, 0)}% (deve fare 100%)</p>
                    )}
                  </div>

                  {c.piano.righe.length > 0 && (
                    <div className="px-4 mt-3">
                      <BarraSoglie righe={c.piano.righe} ribasso={c.ribasso} />
                      <BarraCapitale piano={c.piano} />
                    </div>
                  )}

                  {/* sulla discesa */}
                  {c.piano.righe.length > 0 && (
                    <div className="px-3 sm:px-4 mt-4 pb-4">
                      <p className="text-[11px] font-medium text-gray-500 mb-1.5 px-1">Importi consigliati lungo la discesa</p>
                      <TabellaTranche piano={c.piano} />
                      {(() => {
                        const av = savedTranche
                          .filter(t => t.portafoglio_id === id && (t.attivazioni ?? 0) > 0)
                          .sort((x, y) => x.soglia_pct - y.soglia_pct)
                        if (av.length === 0) return null
                        return (
                          <p className="mt-2 px-1 text-[11px] text-gray-500 leading-snug">
                            <span className="font-medium text-gray-600">Avvisi già inviati:</span>{' '}
                            {av.map(t => `−${nf(Number(t.soglia_pct))}%: ${t.attivazioni}× (ultimo ${fmtData(t.ultima_notifica_at) ?? '–'})`).join(' · ')}
                          </p>
                        )
                      })()}
                      <div className="flex flex-wrap items-center justify-between gap-2 mt-2.5 px-1">
                        <p className="text-[10px] text-gray-400 leading-snug">
                          Le soglie in attesa si calcolano al prezzo che avrebbe l&apos;asset in quel punto, ipotizzando di aver comprato le tranche precedenti.
                        </p>
                        {onSimula && c.piano.importoOra > 0 && (
                          <button onClick={() => onSimula(id, c.piano.importoOra)} className="text-[11px] font-medium text-brand-700 hover:underline whitespace-nowrap">
                            Simula l&apos;acquisto di adesso →
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              )
            })}
          </div>

          {/* aggiungi asset */}
          <div className="card flex flex-wrap items-center gap-2">
            <select value={aggiungi} onChange={e => setAggiungi(e.target.value)} className="input !w-auto min-w-[12rem] !py-1.5 text-xs">
              <option value="">Aggiungi un asset al piano…</option>
              {candidati.map(a => <option key={a.id} value={a.id}>{a.nome || a.descrizione || a.ticker} ({a.ticker})</option>)}
            </select>
            <button disabled={!aggiungi} onClick={() => { setDrafts(p => [...p, nuovaDraft(aggiungi)]); setAggiungi('') }} className="btn-secondary !py-1.5 !px-3 text-xs disabled:opacity-40">
              + Aggiungi
            </button>
            <span className="text-[11px] text-gray-400">Ogni asset parte con soglie −5/−10/−15/−20% e pesi crescenti: modificali come preferisci.</span>
          </div>
        </div>
      </div>

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
