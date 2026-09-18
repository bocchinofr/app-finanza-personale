// app/dashboard/fire/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import {
  Liquidita, AssetPortafoglio, Movimento, FondoPensione, Profilo,
  MESI, CATEGORIE_ENTRATE, CATEGORIE_USCITE, CATEGORIE_INVESTIMENTI,
  statoAttuale,
} from '@/types/index'
import {
  calcolaProiezioneFire, calcolaFireNumber, calcolaRunway, calcolaSostenibilitaPostFire,
  confrontaConSnapshot, AnnoProiezione, ConfrontoAnnuale, FireParametri, Debito,
} from '@/lib/fireCalculations'
import FireInfoBox from '@/components/fire/FireInfoBox'
import FireAssumptionsPanel from '@/components/fire/FireAssumptionsPanel'
import FireNumberCard from '@/components/fire/FireNumberCard'
import RunwayCard from '@/components/fire/RunwayCard'
import PostFireCard from '@/components/fire/PostFireCard'
import FireReviewCard from '@/components/fire/FireReviewCard'
import FireProjectionChart from '@/components/fire/FireProjectionChart'

const DEFAULT_SWR = 4
const DEFAULT_INFLAZIONE = 2
const DEFAULT_TASSAZIONE_INTERESSI = 26
const DEFAULT_TASSAZIONE_FONDO = 15
const DEFAULT_ORIZZONTE = 50
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

export default function FirePage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [errore, setErrore] = useState<string | null>(null)

  const [etaAttuale, setEtaAttuale] = useState<number | null>(null)
  const [birthDateMancante, setBirthDateMancante] = useState(false)

  const [speseAnnueBase, setSpeseAnnueBase] = useState(0)
  const [investimentoAnnuoBase, setInvestimentoAnnuoBase] = useState(0)
  const [patrimonioLiquidoIniziale, setPatrimonioLiquidoIniziale] = useState(0)
  const [fondoPensioneIniziale, setFondoPensioneIniziale] = useState(0)
  const [rendimentoFondoStorico, setRendimentoFondoStorico] = useState(5)

  const [parametri, setParametri] = useState<FireParametri | null>(null)

  // Confronto con lo snapshot congelato per l'anno corrente (revisione annuale)
  const [confronto, setConfronto] = useState<ConfrontoAnnuale | null>(null)
  const [annoSnapshot, setAnnoSnapshot] = useState<number | null>(null)
  const [snapshotGestito, setSnapshotGestito] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setErrore(null)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const annoCorrente = new Date().getFullYear()

      const [profRes, liqRes, portRes, movRes, fondoRes] = await Promise.all([
        supabase.from('profili').select('*').eq('user_id', user.id).single(),
        supabase.from('liquidita').select('*').eq('user_id', user.id).eq('anno', annoCorrente),
        supabase.from('portafoglio').select('*').eq('user_id', user.id),
        supabase.from('movimenti').select('*').eq('user_id', user.id).eq('anno', annoCorrente),
        supabase.from('fondo_pensione').select('*').eq('user_id', user.id).eq('anno', annoCorrente),
      ])
      if (cancelled) return

      // --- Età da profilo ---
      const profilo = profRes.data as (Profilo & { birth_date?: string | null }) | null
      if (profRes.error) {
        setErrore('Impossibile leggere il profilo (verifica che la colonna birth_date esista).')
      } else {
        const eta = calcolaEta(profilo?.birth_date)
        if (eta === null) setBirthDateMancante(true)
        setEtaAttuale(eta ?? ETA_DEFAULT_SE_MANCANTE)
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

      setPatrimonioLiquidoIniziale(liquiditaTotale + capitaleInvestito)

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
      setFondoPensioneIniziale(fondoTotale)
      if (fondoTotale > 0 && fondoInteressi !== 0) {
        setRendimentoFondoStorico(Math.round((fondoInteressi / fondoTotale) * 1000) / 10)
      }

      // --- Spese e investimenti: media mensile dei mesi con dati, annualizzata ---
      const movimenti = (movRes.data ?? []) as Movimento[]
      const mesiConMovimenti = new Set(movimenti.map(m => m.mese)).size || 1

      const speseTotali = movimenti
        .filter(m => CATEGORIE_USCITE.includes(m.categoria))
        .reduce((sum, m) => sum + (m.uscite ?? 0), 0)
      const investimentiTotali = movimenti
        .filter(m => CATEGORIE_INVESTIMENTI.includes(m.categoria))
        .reduce((sum, m) => sum + (m.uscite ?? 0), 0)
      void movimenti.filter(m => CATEGORIE_ENTRATE.includes(m.categoria))

      setSpeseAnnueBase(Math.round((speseTotali / mesiConMovimenti) * 12))
      setInvestimentoAnnuoBase(Math.round((investimentiTotali / mesiConMovimenti) * 12))

      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Inizializza i parametri di default una sola volta, appena i dati aggregati
  // sono pronti. Dopo l'inizializzazione l'utente li modifica liberamente.
  useEffect(() => {
    if (parametri !== null) return
    if (loading) return
    if (etaAttuale === null) return

    const oggi = new Date()
    setParametri({
      annoIniziale: oggi.getFullYear(),
      etaIniziale: etaAttuale,
      speseAnnueBase,
      crescitaSpesePct: DEFAULT_INFLAZIONE,
      investimentoAnnuoBase,
      crescitaInvestimentoPct: 0,
      patrimonioLiquidoIniziale,
      rendimentoInvestimentiPct: 6,
      fondoPensioneIniziale,
      rendimentoFondoPensionePct: rendimentoFondoStorico,
      includiFondoPensioneInFireNumber: false,
      etaRitiroFondoPensione: DEFAULT_ETA_RITIRO_FONDO,
      quotaCapitaleFondoPensionePct: DEFAULT_QUOTA_CAPITALE_FONDO,
      inflazionePct: DEFAULT_INFLAZIONE,
      swrPct: DEFAULT_SWR,
      tassazioneInteressiPct: DEFAULT_TASSAZIONE_INTERESSI,
      tassazioneFondoPensionePct: DEFAULT_TASSAZIONE_FONDO,
      debiti: [] as Debito[],
      orizzonteAnni: DEFAULT_ORIZZONTE,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, etaAttuale, speseAnnueBase, investimentoAnnuoBase, patrimonioLiquidoIniziale, fondoPensioneIniziale, rendimentoFondoStorico])

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
    if (!parametri || proiezione.length === 0) return

    let cancelled = false
    async function gestisciSnapshot() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !parametri) return

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
        .select('anno_creazione, proiezione')
        .eq('user_id', user.id)
        .eq('anno_creazione', annoCorrente)
        .single()

      if (cancelled || !snapshotRow) return

      const proiezioneSnapshot = snapshotRow.proiezione as AnnoProiezione[]
      const risultatoConfronto = confrontaConSnapshot(annoCorrente, proiezioneSnapshot, {
        speseReali: speseAnnueBase,
        investimentoReale: investimentoAnnuoBase,
        patrimonioReale: patrimonioLiquidoIniziale + fondoPensioneIniziale,
      })

      setConfronto(risultatoConfronto)
      setAnnoSnapshot(snapshotRow.anno_creazione)
      setSnapshotGestito(true)
    }
    gestisciSnapshot()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parametri, proiezione, snapshotGestito])

  if (loading || !parametri) {
    return <div className="flex items-center justify-center h-64 text-sm text-gray-400">Caricamento…</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl text-stone-800">FIRE</h1>
        <p className="text-sm text-stone-500">
          Quando potrai vivere di rendita, e quanto dura il capitale se smettessi oggi.
        </p>
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

      <FireInfoBox />

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
    </div>
  )
}
