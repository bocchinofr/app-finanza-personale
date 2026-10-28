// app/dashboard/fire/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import {
  Liquidita, AssetPortafoglio, Movimento, FondoPensione, Profilo,
  MESI, CATEGORIE_USCITE, CATEGORIE_INVESTIMENTI,
  statoAttuale,
} from '@/types/index'
import {
  calcolaProiezioneFire, calcolaFireNumber, calcolaRunway, calcolaSostenibilitaPostFire,
  confrontaConSnapshot, confrontaProiezioni,
  AnnoProiezione, ConfrontoAnnuale, EsitoRicalcolo, FireParametri, Debito,
} from '@/lib/fireCalculations'
import FireInfoBox from '@/components/fire/FireInfoBox'
import FireAssumptionsPanel from '@/components/fire/FireAssumptionsPanel'
import FireNumberCard from '@/components/fire/FireNumberCard'
import RunwayCard from '@/components/fire/RunwayCard'
import PostFireCard from '@/components/fire/PostFireCard'
import FireReviewCard from '@/components/fire/FireReviewCard'
import FireProjectionChart from '@/components/fire/FireProjectionChart'
import FireTabellaPrevisionale from '@/components/fire/FireTabellaPrevisionale'

const DEFAULT_SWR = 4
const DEFAULT_INFLAZIONE = 2
const DEFAULT_TASSAZIONE_INTERESSI = 26
const DEFAULT_TASSAZIONE_FONDO = 15
const DEFAULT_ORIZZONTE = 100
const DEFAULT_ETA_RITIRO_FONDO = 67
const DEFAULT_QUOTA_CAPITALE_FONDO = 50
const ETA_DEFAULT_SE_MANCANTE = 40

function calcolaEta(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null
  const nascita = new Date(birthDate)
  if (isNaN(nascita.getTime())) return null
  const oggi = new Date()
  let eta = oggi.getFullYear() - nascita.getFullYear()
  const compleannoPassato =
    oggi.getMonth() > nascita.getMonth() ||
    (oggi.getMonth() === nascita.getMonth() && oggi.getDate() >= nascita.getDate())
  if (!compleannoPassato) eta -= 1
  return eta
}

// Solo le entrate ricorrenti entrano nel modello (esclusi interessi, rimborsi, vendita titoli)
const CATEGORIE_ENTRATE_RICORRENTI = ['STIPENDIO G', 'STIPENDIO F', 'ASSEGNO UNICO', 'BONUS NIDO']

interface DatiAttuali {
  etaAttuale: number
  entrateAnnueBase: number
  speseAnnueBase: number
  investimentoAnnuoBase: number
  patrimonioLiquidoIniziale: number
  fondoPensioneIniziale: number
  rendimentoFondoStorico: number
}

interface SnapshotSalvato {
  annoCreazione: number
  proiezione: AnnoProiezione[]
  ricalcolatoIl: string | null
}

interface RigaSnapshot {
  anno_creazione: number
  proiezione: AnnoProiezione[]
  ricalcolato_il: string | null
}

type SupabaseClient = ReturnType<typeof createClient>

/** Legge dal DB la situazione attuale (anno corrente) e restituisce i valori base del modello. */
async function fetchDatiAttuali(
  supabase: SupabaseClient,
  userId: string
): Promise<{ dati: DatiAttuali; errore: string | null; birthDateMancante: boolean }> {
  const annoCorrente = new Date().getFullYear()

  const [profRes, liqRes, portRes, movRes, fondoRes] = await Promise.all([
    supabase.from('profili').select('*').eq('user_id', userId).single(),
    supabase.from('liquidita').select('*').eq('user_id', userId).eq('anno', annoCorrente),
    supabase.from('portafoglio').select('*').eq('user_id', userId),
    supabase.from('movimenti').select('*').eq('user_id', userId).eq('anno', annoCorrente),
    supabase.from('fondo_pensione').select('*').eq('user_id', userId).eq('anno', annoCorrente),
  ])

  // --- Età da profilo ---
  const profilo = profRes.data as (Profilo & { birth_date?: string | null }) | null
  let errore: string | null = null
  let eta: number | null = null
  if (profRes.error) {
    errore = 'Impossibile leggere il profilo (verifica che la colonna birth_date esista).'
  } else {
    eta = calcolaEta(profilo?.birth_date)
  }

  // --- Liquidità: ultimo mese valorizzato dell'anno corrente ---
  const liquidita = (liqRes.data ?? []) as Liquidita[]
  const mesiConLiquidita = [...new Set(liquidita.map(l => l.mese))]
  const ultimoMeseLiquidita = MESI.filter(m => mesiConLiquidita.includes(m)).pop()
  const liquiditaTotale = liquidita
    .filter(l => l.mese === ultimoMeseLiquidita)
    .reduce((sum, l) => sum + (l.saldo ?? 0), 0)

  // --- Portafoglio: valore a prezzo di carico ---
  const portafoglio = (portRes.data ?? []) as AssetPortafoglio[]
  const capitaleInvestito = portafoglio.reduce((sum, a) => {
    const { quantita, prezzoCarico } = statoAttuale(a)
    return sum + quantita * prezzoCarico
  }, 0)

  // --- Fondo pensione: ultimo mese valorizzato ---
  const fondoPensione = (fondoRes.data ?? []) as FondoPensione[]
  const mesiConFondo = [...new Set(fondoPensione.map(f => f.mese))]
  const ultimoMeseFondo = MESI.filter(m => mesiConFondo.includes(m)).pop()
  const fondoTotale = fondoPensione
    .filter(f => f.mese === ultimoMeseFondo)
    .reduce((sum, f) => sum + (f.saldo ?? 0), 0)
  const fondoInteressi = fondoPensione
    .filter(f => f.mese === ultimoMeseFondo)
    .reduce((sum, f) => sum + (f.interessi ?? 0), 0)
  let rendimentoFondoStorico = 5
  if (fondoTotale > 0 && fondoInteressi !== 0) {
    rendimentoFondoStorico = Math.round((fondoInteressi / fondoTotale) * 1000) / 10
  }

  // --- Entrate, spese e investimenti: media mensile dei mesi con dati, annualizzata ---
  const movimenti = (movRes.data ?? []) as Movimento[]
  const mesiConMovimenti = new Set(movimenti.map(m => m.mese)).size || 1

  const entrateTotali = movimenti
    .filter(m => CATEGORIE_ENTRATE_RICORRENTI.includes(m.categoria))
    .reduce((sum, m) => sum + (m.entrate ?? 0), 0)
  const speseTotali = movimenti
    .filter(m => CATEGORIE_USCITE.includes(m.categoria))
    .reduce((sum, m) => sum + (m.uscite ?? 0), 0)
  const investimentiTotali = movimenti
    .filter(m => CATEGORIE_INVESTIMENTI.includes(m.categoria))
    .reduce((sum, m) => sum + (m.uscite ?? 0), 0)

  return {
    dati: {
      etaAttuale: eta ?? ETA_DEFAULT_SE_MANCANTE,
      entrateAnnueBase: Math.round((entrateTotali / mesiConMovimenti) * 12),
      speseAnnueBase: Math.round((speseTotali / mesiConMovimenti) * 12),
      investimentoAnnuoBase: Math.round((investimentiTotali / mesiConMovimenti) * 12),
      patrimonioLiquidoIniziale: liquiditaTotale + capitaleInvestito,
      fondoPensioneIniziale: fondoTotale,
      rendimentoFondoStorico,
    },
    errore,
    birthDateMancante: !profRes.error && eta === null,
  }
}

function parametriDefault(dati: DatiAttuali): FireParametri {
  return {
    annoIniziale: new Date().getFullYear(),
    etaIniziale: dati.etaAttuale,
    entrateAnnueBase: dati.entrateAnnueBase,
    crescitaEntratePct: DEFAULT_INFLAZIONE,
    speseAnnueBase: dati.speseAnnueBase,
    crescitaSpesePct: DEFAULT_INFLAZIONE,
    investimentoAnnuoBase: dati.investimentoAnnuoBase,
    crescitaInvestimentoPct: 0,
    patrimonioLiquidoIniziale: dati.patrimonioLiquidoIniziale,
    rendimentoInvestimentiPct: 6,
    fondoPensioneIniziale: dati.fondoPensioneIniziale,
    rendimentoFondoPensionePct: dati.rendimentoFondoStorico,
    includiFondoPensioneInFireNumber: false,
    etaRitiroFondoPensione: DEFAULT_ETA_RITIRO_FONDO,
    quotaCapitaleFondoPensionePct: DEFAULT_QUOTA_CAPITALE_FONDO,
    inflazionePct: DEFAULT_INFLAZIONE,
    swrPct: DEFAULT_SWR,
    tassazioneInteressiPct: DEFAULT_TASSAZIONE_INTERESSI,
    tassazioneFondoPensionePct: DEFAULT_TASSAZIONE_FONDO,
    debiti: [] as Debito[],
    orizzonteAnni: DEFAULT_ORIZZONTE,
  }
}

function messaggioErrore(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'message' in e) {
    return String((e as { message: unknown }).message)
  }
  return 'errore sconosciuto'
}

export default function FirePage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [errore, setErrore] = useState<string | null>(null)
  const [birthDateMancante, setBirthDateMancante] = useState(false)

  const [dati, setDati] = useState<DatiAttuali | null>(null)
  const [parametri, setParametri] = useState<FireParametri | null>(null)

  // Previsione di riferimento salvata (fire_snapshot) e confronto con i dati reali
  const [snapshot, setSnapshot] = useState<SnapshotSalvato | null>(null)
  const [confronto, setConfronto] = useState<ConfrontoAnnuale | null>(null)
  const [annoSnapshot, setAnnoSnapshot] = useState<number | null>(null)
  const [snapshotGestito, setSnapshotGestito] = useState(false)

  // Ricalcolo manuale
  const [ricalcolando, setRicalcolando] = useState(false)
  const [esito, setEsito] = useState<EsitoRicalcolo | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setErrore(null)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const r = await fetchDatiAttuali(supabase, user.id)
      if (cancelled) return

      setErrore(r.errore)
      setBirthDateMancante(r.birthDateMancante)
      setDati(r.dati)
      setParametri(parametriDefault(r.dati))
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const proiezione = useMemo(
    () => (parametri ? calcolaProiezioneFire(parametri) : []),
    [parametri]
  )
  const fireNumberResult = useMemo(
    () => (parametri ? calcolaFireNumber(proiezione, parametri) : null),
    [proiezione, parametri]
  )
  const postFireResult = useMemo(
    () => (fireNumberResult ? calcolaSostenibilitaPostFire(proiezione, fireNumberResult) : null),
    [proiezione, fireNumberResult]
  )

  // Snapshot annuale: al primo caricamento dell'anno, se non esiste ancora uno
  // snapshot per l'anno corrente, lo crea congelando parametri e proiezione
  // attuali. Poi carica lo snapshot di riferimento (nuovo o già esistente) e
  // calcola il confronto reale-vs-previsto per l'anno in corso.
  useEffect(() => {
    if (snapshotGestito) return
    if (!parametri || !dati || proiezione.length === 0) return

    let cancelled = false
    async function gestisciSnapshot() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !parametri || !dati) return

      const annoCorrente = parametri.annoIniziale

      await supabase.from('fire_snapshot').upsert(
        {
          user_id: user.id,
          anno_creazione: annoCorrente,
          parametri,
          proiezione,
        },
        { onConflict: 'user_id,anno_creazione', ignoreDuplicates: true }
      )

      const { data: snapshotRow } = await supabase
        .from('fire_snapshot')
        .select('anno_creazione, proiezione, ricalcolato_il')
        .eq('user_id', user.id)
        .eq('anno_creazione', annoCorrente)
        .single()

      if (cancelled || !snapshotRow) return

      const riga = snapshotRow as RigaSnapshot
      setSnapshot({
        annoCreazione: riga.anno_creazione,
        proiezione: riga.proiezione,
        ricalcolatoIl: riga.ricalcolato_il,
      })
      setConfronto(
        confrontaConSnapshot(annoCorrente, riga.proiezione, {
          speseReali: dati.speseAnnueBase,
          investimentoReale: dati.investimentoAnnuoBase,
          patrimonioReale: dati.patrimonioLiquidoIniziale + dati.fondoPensioneIniziale,
        })
      )
      setAnnoSnapshot(riga.anno_creazione)
      setSnapshotGestito(true)
    }
    gestisciSnapshot()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parametri, dati, proiezione, snapshotGestito])

  // Ricalcola: rilegge i dati di oggi, rifà la proiezione da oggi a fine orizzonte,
  // la confronta con la precedente (stesso anno) e sovrascrive la previsione salvata.
  async function handleRicalcola() {
    if (!parametri || ricalcolando) return
    setRicalcolando(true)
    setEsito(null)
    setErrore(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('sessione scaduta')

      const r = await fetchDatiAttuali(supabase, user.id)
      const anno = new Date().getFullYear()

      const nuoviParametri: FireParametri = {
        ...parametri,
        annoIniziale: anno,
        etaIniziale: r.dati.etaAttuale,
        entrateAnnueBase: r.dati.entrateAnnueBase,
        speseAnnueBase: r.dati.speseAnnueBase,
        investimentoAnnuoBase: r.dati.investimentoAnnuoBase,
        patrimonioLiquidoIniziale: r.dati.patrimonioLiquidoIniziale,
        fondoPensioneIniziale: r.dati.fondoPensioneIniziale,
      }
      const nuovaProiezione = calcolaProiezioneFire(nuoviParametri)

      // Previsione precedente: se quest'anno hai già ricalcolato, è quella;
      // altrimenti l'ultima degli anni passati (o, in mancanza, quella automatica di quest'anno).
      const { data: righe, error: errLettura } = await supabase
        .from('fire_snapshot')
        .select('anno_creazione, proiezione, ricalcolato_il')
        .eq('user_id', user.id)
        .order('anno_creazione', { ascending: false })
        .limit(5)
      if (errLettura) throw errLettura

      const righeSnapshot = (righe ?? []) as RigaSnapshot[]
      const rigaCorrente = righeSnapshot.find(x => x.anno_creazione === anno) ?? null
      const baseline: RigaSnapshot | null = rigaCorrente?.ricalcolato_il
        ? rigaCorrente
        : (righeSnapshot.find(x => x.anno_creazione < anno) ?? rigaCorrente)
      const esitoRicalcolo = baseline ? confrontaProiezioni(nuovaProiezione, baseline.proiezione) : null

      const adesso = new Date().toISOString()
      const { error: errSalvataggio } = await supabase.from('fire_snapshot').upsert(
        {
          user_id: user.id,
          anno_creazione: anno,
          parametri: nuoviParametri,
          proiezione: nuovaProiezione,
          ricalcolato_il: adesso,
        },
        { onConflict: 'user_id,anno_creazione' }
      )
      if (errSalvataggio) throw errSalvataggio

      setDati(r.dati)
      setParametri(nuoviParametri)
      setSnapshot({ annoCreazione: anno, proiezione: nuovaProiezione, ricalcolatoIl: adesso })
      setConfronto(
        confrontaConSnapshot(anno, nuovaProiezione, {
          speseReali: r.dati.speseAnnueBase,
          investimentoReale: r.dati.investimentoAnnuoBase,
          patrimonioReale: r.dati.patrimonioLiquidoIniziale + r.dati.fondoPensioneIniziale,
        })
      )
      setAnnoSnapshot(anno)
      setEsito(esitoRicalcolo)
    } catch (e) {
      setErrore('Ricalcolo non riuscito: ' + messaggioErrore(e))
    } finally {
      setRicalcolando(false)
    }
  }

  if (loading || !parametri) {
    return <div className="flex items-center justify-center h-64 text-sm text-gray-400">Caricamento…</div>
  }

  const etichettaCalcolo = snapshot
    ? snapshot.ricalcolatoIl
      ? `calcolata il ${new Date(snapshot.ricalcolatoIl).toLocaleDateString('it-IT')}`
      : `calcolata a inizio ${snapshot.annoCreazione}`
    : ''

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1.5">
        <div>
          <h1 className="font-serif text-2xl text-stone-800">FIRE</h1>
          <p className="text-sm text-stone-500">
            Quando potrai vivere di rendita, e quanto dura il capitale se smettessi oggi.
          </p>
        </div>
        <FireInfoBox />
      </div>

      {errore && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {errore}
        </div>
      )}
      {birthDateMancante && !errore && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Data di nascita non impostata: vai su Profilo per inserirla. Nel frattempo uso {ETA_DEFAULT_SE_MANCANTE} anni come default.
        </div>
      )}

      <FireAssumptionsPanel parametri={parametri} onChange={setParametri} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {fireNumberResult && <FireNumberCard risultato={fireNumberResult} />}
        {postFireResult && (
          <PostFireCard
            risultato={postFireResult}
            etaRitiroFondoPensione={parametri.etaRitiroFondoPensione}
          />
        )}
        <RunwayCard calcolaRunway={(includiFondo) => calcolaRunway(parametri, includiFondo)} />
      </div>

      {confronto && annoSnapshot && (
        <FireReviewCard confronto={confronto} annoSnapshot={annoSnapshot} />
      )}

      <FireProjectionChart proiezione={proiezione} />

      {snapshot && (
        <FireTabellaPrevisionale
          proiezione={snapshot.proiezione}
          annoCorrente={parametri.annoIniziale}
          etichettaCalcolo={etichettaCalcolo}
          onRicalcola={handleRicalcola}
          ricalcolando={ricalcolando}
          esito={esito}
          onChiudiEsito={() => setEsito(null)}
        />
      )}
    </div>
  )
}
