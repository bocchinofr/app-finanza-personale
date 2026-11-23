'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { Liquidita, AssetPortafoglio, Movimento, FondoPensione, MESI, type Mese, statoAttuale } from '@/types'
import { useAnno } from '@/lib/AnnoContext'
import KpiCard from '@/components/ui/KpiCard'
import InfoBox from '@/components/ui/InfoBox'
import {
  AndamentoPatrimonio, ComposizioneCard, RiepilogoAnnoCard, DettaglioMensileDrawer,
  type VistaPatrimonio, type ColonnaEvidenziata,
} from '@/components/patrimonio/PatrimonioSezioni'

const MESI_LABEL: Record<string, string> = {
  gen: 'Gen', feb: 'Feb', mar: 'Mar', apr: 'Apr', mag: 'Mag', giu: 'Giu',
  lug: 'Lug', ago: 'Ago', set: 'Set', ott: 'Ott', nov: 'Nov', dic: 'Dic',
}

// Valore legacy del campo "asset" (grouping) che marcava un asset come fondo
// pensione nel vecchio approccio. Il fondo pensione ora arriva dal foglio
// dedicato, ma teniamo questo filtro per sicurezza: se in portafoglio è
// rimasto un asset con questo tag, non finisce doppio nel capitale investito.
const CATEGORIA_FONDO_PENSIONE_LEGACY = 'Fondo Pensione'

function fmtEuro(n: number) {
  return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

export default function PatrimonioPage() {
  const supabase = createClient()
  const { anno } = useAnno()
  const [loading, setLoading] = useState(true)
  const [liquidita, setLiquidita] = useState<Liquidita[]>([])
  const [portafoglio, setPortafoglio] = useState<AssetPortafoglio[]>([])
  const [movimenti, setMovimenti] = useState<Movimento[]>([])
  const [fondoPensione, setFondoPensione] = useState<FondoPensione[]>([])
  const [portafoglioStorico, setPortafoglioStorico] = useState<{ mese: string; plus_minus: number; valore_mercato: number }[]>([])
  const [prezziAttuali, setPrezziAttuali] = useState<Record<string, number>>({})
  const [vistaPercentuale, setVistaPercentuale] = useState(false)
  const [vista, setVista] = useState<VistaPatrimonio>('mensile')
  const [drawerAperto, setDrawerAperto] = useState(false)
  const [meseEvidenziato, setMeseEvidenziato] = useState<string | null>(null)
  const [colonnaEvidenziata, setColonnaEvidenziata] = useState<ColonnaEvidenziata>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const [liqRes, portRes, movRes, fondoRes, storicoRes] = await Promise.all([
        supabase.from('liquidita').select('*').eq('user_id', user.id).eq('anno', anno),
        supabase.from('portafoglio').select('*').eq('user_id', user.id),
        supabase.from('movimenti').select('*').eq('user_id', user.id).eq('anno', anno).eq('categoria', 'INVESTIMENTI'),
        supabase.from('fondo_pensione').select('*').eq('user_id', user.id).eq('anno', anno),
        supabase.from('portafoglio_storico').select('mese, plus_minus, valore_mercato').eq('user_id', user.id).eq('anno', anno),
      ])
      if (cancelled) return
      setLiquidita(liqRes.data ?? [])
      setPortafoglio(portRes.data ?? [])
      setMovimenti(movRes.data ?? [])
      setFondoPensione(fondoRes.data ?? [])
      setPortafoglioStorico(storicoRes.data ?? [])
      setLoading(false)

      // Prezzi correnti via proxy Yahoo Finance server-side
      const tickers = (portRes.data ?? [])
        .filter((a: AssetPortafoglio) => statoAttuale(a).quantita > 0)
        .map((a: AssetPortafoglio) => a.ticker)
      if (tickers.length > 0) {
        try {
          const res = await fetch(`/api/quote?tickers=${encodeURIComponent(tickers.join(','))}`)
          const json: Record<string, { price: number }> = await res.json()
          if (!cancelled) {
            const prices: Record<string, number> = {}
            for (const [ticker, q] of Object.entries(json)) prices[ticker] = q.price
            setPrezziAttuali(prices)
          }
        } catch {
          // silenzioso: la card mostrerà il valore a prezzo di carico se manca la quotazione
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [anno])

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-sm text-gray-400">Caricamento…</div>
  }

  // Liquidità totale: somma saldi di tutti i conti nell'ultimo mese valorizzato dell'anno selezionato
  const mesiConLiquidita = [...new Set(liquidita.map(l => l.mese))]
  const ultimoMeseLiquidita = MESI.filter(m => mesiConLiquidita.includes(m)).pop()
  const liquiditaTotale = liquidita
    .filter(l => l.mese === ultimoMeseLiquidita)
    .reduce((sum, l) => sum + (l.saldo ?? 0), 0)

  // Capitale investito: tutti gli asset in portafoglio (esclusi eventuali residui
  // legacy taggati come fondo pensione), a valore di mercato attuale
  const assetInvestiti = portafoglio.filter(
    a => a.asset !== CATEGORIA_FONDO_PENSIONE_LEGACY && statoAttuale(a).quantita > 0
  )

  function valoreMercato(a: AssetPortafoglio) {
    const { quantita, prezzoCarico } = statoAttuale(a)
    const prezzo = prezziAttuali[a.ticker] ?? prezzoCarico
    return prezzo * quantita
  }
  function valoreCarico(a: AssetPortafoglio) {
    const { quantita, prezzoCarico } = statoAttuale(a)
    return prezzoCarico * quantita
  }

  const capitaleInvestito = assetInvestiti.reduce((sum, a) => sum + valoreMercato(a), 0)
  const carico = assetInvestiti.reduce((sum, a) => sum + valoreCarico(a), 0)
  const plusMinusInvestimenti = capitaleInvestito - carico

  // Ticker per cui la quotazione live non è disponibile: valoreMercato ricade
  // sul prezzo di carico (plus/minus = 0 per quell'asset), quindi il totale
  // può risultare più basso del reale se una o più quotazioni non arrivano.
  const tickerSenzaPrezzoLive = [...new Set(
    assetInvestiti.filter(a => a.ticker && prezziAttuali[a.ticker] == null).map(a => a.ticker)
  )]

  // Fondo pensione: somma saldi/interessi di tutti i fondi nell'ultimo mese valorizzato
  const mesiConFondo = [...new Set(fondoPensione.map(f => f.mese))]
  const ultimoMeseFondo = MESI.filter(m => mesiConFondo.includes(m)).pop()
  const fondoPensioneTotale = fondoPensione
    .filter(f => f.mese === ultimoMeseFondo)
    .reduce((sum, f) => sum + (f.saldo ?? 0), 0)
  const fondoPensioneInteressi = fondoPensione
    .filter(f => f.mese === ultimoMeseFondo)
    .reduce((sum, f) => sum + (f.interessi ?? 0), 0)

  // KPI "Plus/minus": somma investimenti (mercato - carico) + interessi fondo pensione
  const plusMinus = plusMinusInvestimenti + fondoPensioneInteressi
  const plusMinusPct = carico > 0 ? (plusMinusInvestimenti / carico) * 100 : 0
  const fondoPensionePct = fondoPensioneTotale > 0 ? (fondoPensioneInteressi / fondoPensioneTotale) * 100 : 0

  // ===== Variazioni vs mese precedente (per le KPI card) =====
  const mesePrecedente = (mese: Mese | undefined | null): Mese | null => {
    if (!mese) return null
    const idx = MESI.indexOf(mese)
    return idx > 0 ? MESI[idx - 1] : null
  }
  const delta = (attuale: number, precedente: number | null) =>
    precedente == null ? null : {
      value: attuale - precedente,
      pct: precedente !== 0 ? ((attuale - precedente) / Math.abs(precedente)) * 100 : null,
    }

  // Liquidità: confronto diretto coi saldi del mese precedente
  const mesePrecLiquidita = mesePrecedente(ultimoMeseLiquidita)
  const liquiditaPrec = mesePrecLiquidita && mesiConLiquidita.includes(mesePrecLiquidita)
    ? liquidita.filter(l => l.mese === mesePrecLiquidita).reduce((s, l) => s + (l.saldo ?? 0), 0)
    : null
  const deltaLiquidita = delta(liquiditaTotale, liquiditaPrec)

  // Fondo pensione: confronto diretto coi saldi del mese precedente
  const mesePrecFondo = mesePrecedente(ultimoMeseFondo)
  const fondoPrec = mesePrecFondo && mesiConFondo.includes(mesePrecFondo)
    ? fondoPensione.filter(f => f.mese === mesePrecFondo).reduce((s, f) => s + (f.saldo ?? 0), 0)
    : null
  const deltaFondo = delta(fondoPensioneTotale, fondoPrec)

  // Capitale investito e Plus/minus: serve lo storico per-asset da "Registra
  // chiusura mese" (portafoglio_storico), unica fonte con valore di mercato
  // e plus/minus per mese passato.
  const mesiConSnapshotArr = MESI.filter(m => portafoglioStorico.some(r => r.mese === m))
  const ultimoMeseSnapshot = mesiConSnapshotArr[mesiConSnapshotArr.length - 1]
  const capitaleMercatoPerMese = new Map<string, number>()
  const plusMinusInvestPerMese = new Map<string, number>()
  for (const r of portafoglioStorico) {
    capitaleMercatoPerMese.set(r.mese, (capitaleMercatoPerMese.get(r.mese) ?? 0) + (r.valore_mercato ?? 0))
    plusMinusInvestPerMese.set(r.mese, (plusMinusInvestPerMese.get(r.mese) ?? 0) + (r.plus_minus ?? 0))
  }

  const mesePrecCapitale = mesePrecedente(ultimoMeseSnapshot)
  const capitaleInvestitoPrec = mesePrecCapitale ? capitaleMercatoPerMese.get(mesePrecCapitale) ?? null : null
  const deltaCapitale = delta(capitaleInvestito, capitaleInvestitoPrec)

  const interessiFondoMesePrec = mesePrecFondo
    ? fondoPensione.filter(f => f.mese === mesePrecFondo).reduce((s, f) => s + (f.interessi ?? 0), 0)
    : null
  const plusMinusPrec = mesePrecCapitale && capitaleInvestitoPrec != null
    ? (plusMinusInvestPerMese.get(mesePrecCapitale) ?? 0) + (interessiFondoMesePrec ?? 0)
    : null
  const deltaPlusMinus = delta(plusMinus, plusMinusPrec)

  // Patrimonio totale: liquidità + capitale investito (mercato) + fondo pensione.
  // Il plus/minus non si somma a parte: è già incluso nel valore di mercato del
  // capitale investito, sommarlo di nuovo sarebbe un doppio conteggio.
  const patrimonioTotale = liquiditaTotale + capitaleInvestito + fondoPensioneTotale
  const deltaPatrimonioTotale =
    deltaLiquidita && deltaCapitale && deltaFondo
      ? delta(patrimonioTotale, patrimonioTotale - (deltaLiquidita.value + deltaCapitale.value + deltaFondo.value))
      : null

  // ===== Storico mensile a pile: Liquidità / Capitale investito / Fondo pensione =====
  // Capitale investito: ricostruito asset per asset a partire dall'anagrafica.
  //  - Ancora: alla data_acquisto (se cade nell'anno selezionato), il capitale noto
  //    è prezzo_acquisto × quantita.
  //  - Dopo l'ancora: si somma il flusso dei movimenti collegati (portafoglio_id),
  //    con segno invertito rispetto al cash flow: uscita (acquisto) = +, entrata
  //    (disinvestimento) = −.
  //  - Prima dell'ancora (stesso anno): si cammina all'indietro sottraendo lo
  //    stesso flusso; se non ci sono movimenti precedenti, il valore resta 0.
  //  - Se data_acquisto è di un anno precedente a quello selezionato: nessuno
  //    storico multi-anno caricato, fallback approssimato (valore attuale meno
  //    il flusso dell'anno corrente, poi in avanti mese per mese).
  //  - Se data_acquisto è futura rispetto all'anno selezionato: l'asset non
  //    esisteva ancora, contributo 0 per tutto l'anno.
  const netFlowInvestito = (m: Movimento) => (m.uscite ?? 0) - (m.entrate ?? 0)

  function parseDataAcquisto(v: string): { anno: number; meseIdx: number } | null {
    const parti = (v ?? '').split('/')
    if (parti.length !== 3) return null
    const meseNum = Number(parti[1])
    const annoNum = Number(parti[2])
    if (!annoNum || !meseNum || meseNum < 1 || meseNum > 12) return null
    return { anno: annoNum, meseIdx: meseNum - 1 }
  }

  function capitaleAssetPerMese(a: AssetPortafoglio): number[] {
    const risultato = new Array(MESI.length).fill(0)
    const movimentiAsset = movimenti.filter(m => m.portafoglio_id === a.id)
    const flussoMese = (idx: number) =>
      movimentiAsset.filter(m => m.mese === MESI[idx]).reduce((s, m) => s + netFlowInvestito(m), 0)
    const dataAcq = parseDataAcquisto(a.data_acquisto)

    if (dataAcq && dataAcq.anno === anno) {
      const ancoraIdx = dataAcq.meseIdx
      const valoreAncora = a.prezzo_acquisto * a.quantita
      risultato[ancoraIdx] = valoreAncora
      let cum = valoreAncora
      for (let i = ancoraIdx + 1; i < MESI.length; i++) {
        cum += flussoMese(i)
        risultato[i] = cum
      }
      let cumIndietro = valoreAncora
      for (let i = ancoraIdx - 1; i >= 0; i--) {
        cumIndietro -= flussoMese(i + 1)
        risultato[i] = cumIndietro
      }
    } else if (dataAcq && dataAcq.anno < anno) {
      const { quantita, prezzoCarico } = statoAttuale(a)
      const flowAnno = movimentiAsset.reduce((s, m) => s + netFlowInvestito(m), 0)
      let cum = quantita * prezzoCarico - flowAnno
      for (let i = 0; i < MESI.length; i++) {
        cum += flussoMese(i)
        risultato[i] = cum
      }
    }
    // dataAcq.anno > anno (o data mancante/illeggibile): resta 0 ovunque

    return risultato
  }

  const capitalePerAssetPerMese = assetInvestiti.map(a => capitaleAssetPerMese(a))

  // Mesi da mostrare: fino all'ultimo mese con dati (liquidità, movimenti, fondo
  // pensione o snapshot portafoglio), per non proiettare in avanti mesi futuri vuoti
  const mesiConMovimenti = new Set(movimenti.map(m => m.mese))
  const mesiConSnapshot = new Set(portafoglioStorico.map(r => r.mese))
  const ultimoMeseConDati = MESI.filter(
    m => mesiConLiquidita.includes(m) || mesiConMovimenti.has(m) || mesiConFondo.includes(m) || mesiConSnapshot.has(m)
  ).pop() ?? MESI[0]
  const idxUltimoMese = MESI.indexOf(ultimoMeseConDati)
  const mesiDaMostrare = MESI.slice(0, idxUltimoMese + 1)

  const storicoPerMese = new Map<string, number>()
  for (const r of portafoglioStorico) {
    storicoPerMese.set(r.mese, (storicoPerMese.get(r.mese) ?? 0) + (r.plus_minus ?? 0))
  }

  const storicoData = mesiDaMostrare.map(m => {
    const idxMese = MESI.indexOf(m)
    const liquiditaMese = liquidita.filter(l => l.mese === m).reduce((s, l) => s + (l.saldo ?? 0), 0)
    const fondoMese = fondoPensione.filter(f => f.mese === m).reduce((s, f) => s + (f.saldo ?? 0), 0)
    const righeFondoMese = fondoPensione.filter(f => f.mese === m)
    const interessiFondoMese = righeFondoMese.length > 0
      ? righeFondoMese.reduce((s, f) => s + (f.interessi ?? 0), 0)
      : null

    // Se esiste uno snapshot reale per questo mese ("Registra chiusura mese",
    // salvato per asset in portafoglio_storico e sommato qui), il plus/minus
    // investimenti prende quello. Il capitale investito resta sempre la
    // ricostruzione per asset da anagrafica + movimenti, mai il valore di
    // mercato dello snapshot.
    const haSnapshot = mesiConSnapshot.has(m)
    const capitaleInvestitoMese = capitalePerAssetPerMese.reduce((s, arr) => s + arr[idxMese], 0)
    // Plus/minus considerato solo per i mesi con snapshot investimenti registrato:
    // senza snapshot la parte investimenti è ignota, quindi il totale resta N/D
    // (niente fallback a 0, che nasconderebbe il dato mancante).
    const haValorePlusMinus = haSnapshot
    const plusMinusMese = haValorePlusMinus ? (storicoPerMese.get(m) ?? 0) + (interessiFondoMese ?? 0) : null

    const liquiditaRound = Math.round(liquiditaMese)
    const capitaleRound = Math.round(capitaleInvestitoMese)
    const fondoRound = Math.round(fondoMese)
    const plusMinusRound = plusMinusMese != null ? Math.round(plusMinusMese) : null

    return {
      mese: MESI_LABEL[m],
      'Liquidità': liquiditaRound,
      'Capitale investito': capitaleRound,
      'Fondo pensione': fondoRound,
      'Plus/minus': plusMinusRound,
      Totale: liquiditaRound + capitaleRound + fondoRound + (plusMinusRound ?? 0),
    }
  })

  // Vista percentuale: ogni categoria in % del patrimonio "base" del mese
  // (liquidità + capitale investito + fondo pensione, plus/minus escluso dal
  // denominatore perché è una variazione, non una componente di patrimonio).
  const chartData = storicoData.map(r => {
    if (!vistaPercentuale) return r
    const base = r['Liquidità'] + r['Capitale investito'] + r['Fondo pensione']
    if (base === 0) return { ...r, 'Liquidità': 0, 'Capitale investito': 0, 'Fondo pensione': 0, 'Plus/minus': null }
    return {
      ...r,
      'Liquidità': +(r['Liquidità'] / base * 100).toFixed(1),
      'Capitale investito': +(r['Capitale investito'] / base * 100).toFixed(1),
      'Fondo pensione': +(r['Fondo pensione'] / base * 100).toFixed(1),
      'Plus/minus': r['Plus/minus'] == null ? null : +(r['Plus/minus'] / base * 100).toFixed(1),
    }
  })

  // Righe del riepilogo mensile, con delta calcolati vs il mese precedente.
  // Calcolate una volta sola e riusate sia dalla tabella desktop sia
  // dall'accordion mobile.
  const riepilogoRows = storicoData.slice().reverse().map(row => {
    const i = storicoData.findIndex(r => r.mese === row.mese)
    const totale = row['Liquidità'] + row['Capitale investito'] + row['Fondo pensione']
    const rowPrec = i > 0 ? storicoData[i - 1] : null
    const totalePrec = rowPrec ? rowPrec['Liquidità'] + rowPrec['Capitale investito'] + rowPrec['Fondo pensione'] : null
    const varAssoluta = totalePrec != null ? totale - totalePrec : null
    const varPct = totalePrec != null && totalePrec !== 0 ? (varAssoluta! / Math.abs(totalePrec)) * 100 : null
    const varTone = varAssoluta == null ? 'text-gray-300' : varAssoluta >= 0 ? 'text-green-700' : 'text-red-700'
    const plusMinusPrec = rowPrec ? rowPrec['Plus/minus'] : null
    const plusMinusTone =
      row['Plus/minus'] == null ? 'text-gray-300'
      : row['Plus/minus'] < 0 ? 'text-red-700'
      : plusMinusPrec == null ? 'text-green-700'
      : row['Plus/minus'] >= plusMinusPrec ? 'text-green-700' : 'text-amber-600'
    return { row, totale, varAssoluta, varPct, varTone, plusMinusTone }
  })

  function apriDettaglio(mese: string | null = null, colonna: ColonnaEvidenziata = null) {
    setMeseEvidenziato(mese)
    setColonnaEvidenziata(colonna)
    setDrawerAperto(true)
  }

  // Serie per le sparkline dei KPI (andamento dei mesi dell'anno selezionato)
  const serie = (k: 'Liquidità' | 'Capitale investito' | 'Fondo pensione') => storicoData.map(r => r[k])
  const serieTotale = storicoData.map(r => r['Liquidità'] + r['Capitale investito'] + r['Fondo pensione'])

  const plusMinusTone: 'negative' | 'warning' | 'positive' =
    plusMinus < 0 ? 'negative'
    : deltaPlusMinus && deltaPlusMinus.value < 0 ? 'warning'
    : 'positive'

  return (
    <div className="max-w-screen-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          Situazione a <span className="font-medium text-gray-700">{MESI_LABEL[ultimoMeseConDati]} {anno}</span>
          <span className="hidden sm:inline"> · variazioni rispetto al mese precedente · clicca una card per il dettaglio mensile</span>
        </p>
        <InfoBox title="Come leggere i KPI">
          <p><strong>Patrimonio totale</strong> = liquidità + capitale investito (a valore di mercato) + fondo pensione. Il plus/minus è già incluso nel valore di mercato, non si somma a parte.</p>
          <p><strong>Plus/minus</strong> = guadagno o perdita non realizzati sugli investimenti rispetto al prezzo di carico, più gli interessi del fondo pensione.</p>
          <p>Il chip colorato è la variazione rispetto al mese precedente; la linea sotto è l&apos;andamento dei mesi dell&apos;anno.</p>
        </InfoBox>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <KpiCard
          label="Patrimonio totale"
          value={fmtEuro(patrimonioTotale)}
          color="#3f6b4f"
          delta={deltaPatrimonioTotale}
          spark={serieTotale}
          onClick={() => apriDettaglio()}
        />
        <KpiCard
          label="Plus/minus"
          value={`${plusMinus >= 0 ? '+' : '−'}${fmtEuro(Math.abs(plusMinus))}`}
          color="#c65d3b"
          tone={plusMinusTone}
          delta={deltaPlusMinus}
          minis={[
            {
              label: 'Investimenti',
              value: `${plusMinusInvestimenti >= 0 ? '+' : '−'}${fmtEuro(Math.abs(plusMinusInvestimenti))}`,
              sub: `${plusMinusPct >= 0 ? '+' : '−'}${Math.abs(plusMinusPct).toFixed(1).replace('.', ',')}%`,
              tone: plusMinusInvestimenti >= 0 ? 'positive' : 'negative',
            },
            {
              label: 'Fondo pensione',
              value: `${fondoPensioneInteressi >= 0 ? '+' : '−'}${fmtEuro(Math.abs(fondoPensioneInteressi))}`,
              sub: `${fondoPensionePct >= 0 ? '+' : '−'}${Math.abs(fondoPensionePct).toFixed(1).replace('.', ',')}%`,
              tone: fondoPensioneInteressi >= 0 ? 'positive' : 'negative',
            },
          ]}
          onClick={() => apriDettaglio()}
        />
        <KpiCard
          label="Liquidità"
          value={fmtEuro(liquiditaTotale)}
          color="#4a6fa1"
          delta={deltaLiquidita}
          spark={serie('Liquidità')}
          onClick={() => apriDettaglio(null, 'Liquidità')}
        />
        <KpiCard
          label="Capitale investito"
          value={fmtEuro(capitaleInvestito)}
          color="#3f6b4f"
          delta={deltaCapitale}
          spark={serie('Capitale investito')}
          minis={[{ label: 'Prezzo di carico', value: fmtEuro(carico) }]}
          footnote={tickerSenzaPrezzoLive.length > 0 && (
            <>Quotazione non disponibile: {tickerSenzaPrezzoLive.join(', ')} (uso prezzo di carico)</>
          )}
          onClick={() => apriDettaglio(null, 'Capitale investito')}
        />
        <KpiCard
          label="Fondo pensione"
          value={fmtEuro(fondoPensioneTotale)}
          color="#a67c3d"
          delta={deltaFondo}
          spark={serie('Fondo pensione')}
          className="col-span-2 sm:col-span-1"
          onClick={() => apriDettaglio(null, 'Fondo pensione')}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <AndamentoPatrimonio
          anno={anno}
          data={chartData}
          vista={vista}
          onVista={setVista}
          percentuale={vistaPercentuale}
          onPercentuale={setVistaPercentuale}
          onMese={mese => apriDettaglio(mese)}
          onApriDettaglio={() => apriDettaglio()}
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1 content-start">
          <ComposizioneCard
            parti={[
              { label: 'Liquidità', value: liquiditaTotale, color: '#4a6fa1', colonna: 'Liquidità' },
              { label: 'Capitale investito', value: capitaleInvestito, color: '#3f6b4f', colonna: 'Capitale investito' },
              { label: 'Fondo pensione', value: fondoPensioneTotale, color: '#a67c3d', colonna: 'Fondo pensione' },
            ]}
            onSelect={c => apriDettaglio(null, c)}
          />
          <RiepilogoAnnoCard anno={anno} rows={riepilogoRows} />
        </div>
      </div>

      <DettaglioMensileDrawer
        open={drawerAperto}
        onClose={() => setDrawerAperto(false)}
        anno={anno}
        rows={riepilogoRows}
        mese={meseEvidenziato}
        colonna={colonnaEvidenziata}
      />
    </div>
  )
}
