// lib/analisiCalculations.ts
// Logica pura per il popup "Analisi Finanziaria". Nessuna dipendenza da
// Supabase/React: riceve dati già caricati (stesso pattern di fireCalculations.ts)
// e restituisce un oggetto pronto per la UI e per la generazione del prompt AI.

import {
  AssetPortafoglio, Movimento, Liquidita, FondoPensione,
  MESI, CATEGORIE_ENTRATE, CATEGORIE_USCITE, CATEGORIE_INVESTIMENTI,
  statoAttuale,
} from '@/types'
import {
  FireParametri, Debito, calcolaProiezioneFire, calcolaFireNumber,
} from './fireCalculations'

// Stessi default usati in app/dashboard/fire/page.tsx, per restare coerenti
// con la sezione FIRE quando qui non è disponibile un profilo completo.
const DEFAULT_SWR = 4
const DEFAULT_INFLAZIONE = 2
const DEFAULT_TASSAZIONE_INTERESSI = 26
const DEFAULT_TASSAZIONE_FONDO = 15
const DEFAULT_ORIZZONTE = 50
const DEFAULT_ETA_RITIRO_FONDO = 67
const DEFAULT_QUOTA_CAPITALE_FONDO = 50
const DEFAULT_RENDIMENTO_INVESTIMENTI = 6
const ETA_DEFAULT_SE_MANCANTE = 40

// Mesi di spesa da tenere sempre liquidi prima di considerare il resto
// "capitale fermo" da poter investire. Ipotesi standard di educazione
// finanziaria (fondo di emergenza), non un dato dell'utente: va dichiarata
// esplicitamente nell'UI e nel prompt.
const BUFFER_MESI_DEFAULT = 6

// Categorie di CATEGORIE_USCITE considerate "superflue" (discrezionali, comprimibili
// senza impatto su necessità primarie). Classificazione euristica: va verificata/
// adattata da Francesco se non riflette le sue priorità reali.
const CATEGORIE_SUPERFLUE = ['RISTORANTI', 'TEMPO LIBERO', 'ABBIGLIAMENTO', 'AMAZON & CO', 'VACANZE']

// Ipotesi di quanto delle spese superflue sia realisticamente comprimibile,
// e su quanti anni proiettare il risparmio se investito invece che speso.
const PCT_RIDUZIONE_IPOTESI = 20
const ORIZZONTE_PROIEZIONE_RISPARMIO_ANNI = 10

export interface AnalisiInput {
  anno: number
  movimenti: Movimento[]
  portafoglio: AssetPortafoglio[]
  liquidita: Liquidita[]
  fondoPensione: FondoPensione[]
  prezziAttuali?: Record<string, number>
  etaAttuale?: number | null // da profilo; se assente si usa il default FIRE
  bufferMesiLiquidita?: number
}

export interface SituazioneAttuale {
  entrateAnnue: number
  usciteAnnue: number
  investimentiAnnui: number
  risparmioAnnuo: number
  liquiditaAttuale: number
  capitaleInvestitoMercato: number
  capitaleInvestitoCarico: number
  pnlNonRealizzato: number
  fondoPensioneAttuale: number
  patrimonioNetto: number
}

export interface RisparmioVsInvestimento {
  tassoRisparmioPct: number | null
  quotaRisparmioInvestitaPct: number | null
  bufferMesiUsato: number
  bufferConsigliato: number
  capitaleFermoOltreBuffer: number
}

export interface AllocazioneAzObb {
  valoreAzionario: number
  valoreObbligazionario: number
  valoreAltro: number
  pctAzionario: number | null
  pctObbligazionario: number | null
  capitaleLiberoPerAccumulo: number
}

export interface CategoriaSpesa {
  categoria: string
  totale: number
  pctSuTotale: number
  superflua: boolean
}

export interface RiduzioneSpeseSuperflue {
  categorie: CategoriaSpesa[] // solo le categorie classificate come superflue, con importo > 0
  totaleSuperflue: number
  pctIpotesiRiduzione: number // ipotesi di riduzione applicata (es. 20%)
  risparmioPotenzialeAnnuo: number // totaleSuperflue * pctIpotesiRiduzione
  orizzonteProiezioneAnni: number
  valoreSeInvestito: number // valore futuro se il risparmio annuo viene investito ogni anno per orizzonteProiezioneAnni
}

export interface AnalisiSpese {
  categorie: CategoriaSpesa[]
  principali: CategoriaSpesa[] // le categorie di uscita più pesanti (almeno 5, se presenti)
  riduzioneSuperflue: RiduzioneSpeseSuperflue
}

export interface TrendMensile {
  meseRecente: string | null
  speseMeseRecente: number
  speseMediaPrecedenti: number | null
  deltaSpesePct: number | null
  investimentiMeseRecente: number
  investimentiMediaPrecedenti: number | null
  deltaInvestimentiPct: number | null
}

export interface ConcentrazionePortafoglio {
  top3: { nome: string; valore: number; pct: number }[]
  pesoPrincipalePct: number | null
}

export interface RunwayLiquidita {
  mesiCoperti: number | null
}

export interface ImpattoFire {
  disponibile: boolean
  annoStimato: number | null
  anniMancanti: number | null
  etaStimata: number | null
}

export interface EfficienzaFiscale {
  plusvalenzeTotali: number
  minusvalenzeTotali: number
  nettoTassabile: number
  impostaStimata: number
}

export interface AnalisiFinanziaria {
  anno: number
  situazione: SituazioneAttuale
  risparmioInvestimento: RisparmioVsInvestimento
  allocazione: AllocazioneAzObb
  spese: AnalisiSpese
  trend: TrendMensile
  concentrazione: ConcentrazionePortafoglio
  runway: RunwayLiquidita
  fire: ImpattoFire
  fiscale: EfficienzaFiscale
}

function valoreMercato(a: AssetPortafoglio, prezzi: Record<string, number>): number {
  const { quantita, prezzoCarico } = statoAttuale(a)
  const prezzo = prezzi[a.ticker] ?? prezzoCarico
  return prezzo * quantita
}
function valoreCarico(a: AssetPortafoglio): number {
  const { quantita, prezzoCarico } = statoAttuale(a)
  return prezzoCarico * quantita
}

function ultimoMeseValorizzato<T extends { mese: string }>(righe: T[]): string | undefined {
  const presenti = new Set(righe.map(r => r.mese))
  return MESI.filter(m => presenti.has(m)).pop()
}

export function calcolaAnalisiFinanziaria(input: AnalisiInput): AnalisiFinanziaria {
  const prezzi = input.prezziAttuali ?? {}
  const bufferMesi = input.bufferMesiLiquidita ?? BUFFER_MESI_DEFAULT
  const assetAttivi = input.portafoglio.filter(a => statoAttuale(a).quantita > 0)

  // --- 1. Situazione attuale ---
  const entrateAnnue = input.movimenti
    .filter(m => CATEGORIE_ENTRATE.includes(m.categoria))
    .reduce((s, m) => s + (m.entrate ?? 0), 0)
  const usciteAnnue = input.movimenti
    .filter(m => CATEGORIE_USCITE.includes(m.categoria))
    .reduce((s, m) => s + (m.uscite ?? 0), 0)
  const investimentiAnnui = input.movimenti
    .filter(m => CATEGORIE_INVESTIMENTI.includes(m.categoria))
    .reduce((s, m) => s + (m.uscite ?? 0), 0)
  const risparmioAnnuo = entrateAnnue - usciteAnnue

  const ultimoMeseLiq = ultimoMeseValorizzato(input.liquidita)
  const liquiditaAttuale = input.liquidita
    .filter(l => l.mese === ultimoMeseLiq)
    .reduce((s, l) => s + (l.saldo ?? 0), 0)

  const capitaleInvestitoMercato = assetAttivi.reduce((s, a) => s + valoreMercato(a, prezzi), 0)
  const capitaleInvestitoCarico = assetAttivi.reduce((s, a) => s + valoreCarico(a), 0)
  const pnlNonRealizzato = capitaleInvestitoMercato - capitaleInvestitoCarico

  const ultimoMeseFondo = ultimoMeseValorizzato(input.fondoPensione)
  const fondoPensioneAttuale = input.fondoPensione
    .filter(f => f.mese === ultimoMeseFondo)
    .reduce((s, f) => s + (f.saldo ?? 0), 0)

  const situazione: SituazioneAttuale = {
    entrateAnnue, usciteAnnue, investimentiAnnui, risparmioAnnuo,
    liquiditaAttuale, capitaleInvestitoMercato, capitaleInvestitoCarico,
    pnlNonRealizzato, fondoPensioneAttuale,
    patrimonioNetto: liquiditaAttuale + capitaleInvestitoMercato + fondoPensioneAttuale,
  }

  // --- 2. Risparmio vs investimento ---
  const bufferConsigliato = (usciteAnnue / 12) * bufferMesi
  const risparmioInvestimento: RisparmioVsInvestimento = {
    tassoRisparmioPct: entrateAnnue > 0 ? (risparmioAnnuo / entrateAnnue) * 100 : null,
    quotaRisparmioInvestitaPct: risparmioAnnuo > 0 ? (investimentiAnnui / risparmioAnnuo) * 100 : null,
    bufferMesiUsato: bufferMesi,
    bufferConsigliato,
    capitaleFermoOltreBuffer: Math.max(0, liquiditaAttuale - bufferConsigliato),
  }

  // --- 3. Azionario vs obbligazionario ---
  const valoreAzionario = assetAttivi
    .filter(a => a.classe_rischio === 'azionario')
    .reduce((s, a) => s + valoreMercato(a, prezzi), 0)
  const valoreObbligazionario = assetAttivi
    .filter(a => a.classe_rischio === 'obbligazionario')
    .reduce((s, a) => s + valoreMercato(a, prezzi), 0)
  const valoreAltro = capitaleInvestitoMercato - valoreAzionario - valoreObbligazionario
  const valoreSvincolato = assetAttivi
    .filter(a => a.svincolato)
    .reduce((s, a) => s + valoreMercato(a, prezzi), 0)

  const allocazione: AllocazioneAzObb = {
    valoreAzionario, valoreObbligazionario, valoreAltro,
    pctAzionario: capitaleInvestitoMercato > 0 ? (valoreAzionario / capitaleInvestitoMercato) * 100 : null,
    pctObbligazionario: capitaleInvestitoMercato > 0 ? (valoreObbligazionario / capitaleInvestitoMercato) * 100 : null,
    capitaleLiberoPerAccumulo: valoreSvincolato + risparmioInvestimento.capitaleFermoOltreBuffer,
  }

  // --- 4. Analisi spese ---
  const categorie: CategoriaSpesa[] = CATEGORIE_USCITE
    .map(cat => {
      const totale = input.movimenti
        .filter(m => m.categoria === cat)
        .reduce((s, m) => s + (m.uscite ?? 0), 0)
      return {
        categoria: cat,
        totale,
        pctSuTotale: usciteAnnue > 0 ? (totale / usciteAnnue) * 100 : 0,
        superflua: CATEGORIE_SUPERFLUE.includes(cat),
      }
    })
    .filter(c => c.totale > 0)
    .sort((a, b) => b.totale - a.totale)

  const categorieSuperflue = categorie.filter(c => c.superflua)
  const totaleSuperflue = categorieSuperflue.reduce((s, c) => s + c.totale, 0)
  const risparmioPotenzialeAnnuo = totaleSuperflue * (PCT_RIDUZIONE_IPOTESI / 100)
  // Valore futuro di un versamento annuo costante (risparmioPotenzialeAnnuo) per
  // N anni, allo stesso rendimento di riferimento usato nella proiezione FIRE:
  // FV = rata * (((1+r)^n - 1) / r)
  const rTasso = DEFAULT_RENDIMENTO_INVESTIMENTI / 100
  const valoreSeInvestito = risparmioPotenzialeAnnuo > 0
    ? risparmioPotenzialeAnnuo * ((Math.pow(1 + rTasso, ORIZZONTE_PROIEZIONE_RISPARMIO_ANNI) - 1) / rTasso)
    : 0

  const spese: AnalisiSpese = {
    categorie,
    principali: categorie.slice(0, 5),
    riduzioneSuperflue: {
      categorie: categorieSuperflue,
      totaleSuperflue,
      pctIpotesiRiduzione: PCT_RIDUZIONE_IPOTESI,
      risparmioPotenzialeAnnuo,
      orizzonteProiezioneAnni: ORIZZONTE_PROIEZIONE_RISPARMIO_ANNI,
      valoreSeInvestito,
    },
  }

  // --- 5. Trend mensile ---
  const mesiConMovimenti = MESI.filter(m => input.movimenti.some(mv => mv.mese === m))
  const meseRecente = mesiConMovimenti.length > 0 ? mesiConMovimenti[mesiConMovimenti.length - 1] : null
  const mesiPrecedenti = mesiConMovimenti.slice(0, -1)

  function speseDelMese(mese: string) {
    return input.movimenti
      .filter(m => m.mese === mese && CATEGORIE_USCITE.includes(m.categoria))
      .reduce((s, m) => s + (m.uscite ?? 0), 0)
  }
  function investimentiDelMese(mese: string) {
    return input.movimenti
      .filter(m => m.mese === mese && CATEGORIE_INVESTIMENTI.includes(m.categoria))
      .reduce((s, m) => s + (m.uscite ?? 0), 0)
  }

  const speseMeseRecente = meseRecente ? speseDelMese(meseRecente) : 0
  const speseMediaPrecedenti = mesiPrecedenti.length > 0
    ? mesiPrecedenti.reduce((s, m) => s + speseDelMese(m), 0) / mesiPrecedenti.length
    : null
  const investimentiMeseRecente = meseRecente ? investimentiDelMese(meseRecente) : 0
  const investimentiMediaPrecedenti = mesiPrecedenti.length > 0
    ? mesiPrecedenti.reduce((s, m) => s + investimentiDelMese(m), 0) / mesiPrecedenti.length
    : null

  const trend: TrendMensile = {
    meseRecente,
    speseMeseRecente,
    speseMediaPrecedenti,
    deltaSpesePct: speseMediaPrecedenti && speseMediaPrecedenti > 0
      ? ((speseMeseRecente - speseMediaPrecedenti) / speseMediaPrecedenti) * 100 : null,
    investimentiMeseRecente,
    investimentiMediaPrecedenti,
    deltaInvestimentiPct: investimentiMediaPrecedenti && investimentiMediaPrecedenti > 0
      ? ((investimentiMeseRecente - investimentiMediaPrecedenti) / investimentiMediaPrecedenti) * 100 : null,
  }

  // --- 6. Concentrazione portafoglio ---
  const assetConValore = assetAttivi
    .map(a => ({ nome: a.nome || a.ticker, valore: valoreMercato(a, prezzi) }))
    .sort((a, b) => b.valore - a.valore)
  const top3Concentrazione = assetConValore.slice(0, 3).map(a => ({
    ...a,
    pct: capitaleInvestitoMercato > 0 ? (a.valore / capitaleInvestitoMercato) * 100 : 0,
  }))
  const concentrazione: ConcentrazionePortafoglio = {
    top3: top3Concentrazione,
    pesoPrincipalePct: top3Concentrazione[0]?.pct ?? null,
  }

  // --- 7. Runway liquidità ---
  const runway: RunwayLiquidita = {
    mesiCoperti: usciteAnnue > 0 ? liquiditaAttuale / (usciteAnnue / 12) : null,
  }

  // --- 8. Impatto FIRE (stesse assunzioni di default della sezione FIRE) ---
  const annoCorrente = new Date().getFullYear()
  const parametriFire: FireParametri = {
    annoIniziale: annoCorrente,
    etaIniziale: input.etaAttuale ?? ETA_DEFAULT_SE_MANCANTE,
    speseAnnueBase: usciteAnnue,
    crescitaSpesePct: DEFAULT_INFLAZIONE,
    investimentoAnnuoBase: investimentiAnnui,
    crescitaInvestimentoPct: 0,
    patrimonioLiquidoIniziale: liquiditaAttuale + capitaleInvestitoCarico,
    rendimentoInvestimentiPct: DEFAULT_RENDIMENTO_INVESTIMENTI,
    fondoPensioneIniziale: fondoPensioneAttuale,
    rendimentoFondoPensionePct: 5,
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
  const disponibileFire = usciteAnnue > 0
  const fireResult = disponibileFire
    ? calcolaFireNumber(calcolaProiezioneFire(parametriFire), parametriFire)
    : null
  const fire: ImpattoFire = {
    disponibile: disponibileFire,
    annoStimato: fireResult?.annoStimato ?? null,
    anniMancanti: fireResult?.anniMancanti ?? null,
    etaStimata: fireResult?.etaStimata ?? null,
  }

  // --- 9. Efficienza fiscale ---
  let plusvalenzeTotali = 0
  let minusvalenzeTotali = 0
  for (const a of assetAttivi) {
    const pm = valoreMercato(a, prezzi) - valoreCarico(a)
    if (pm >= 0) plusvalenzeTotali += pm
    else minusvalenzeTotali += Math.abs(pm)
  }
  const nettoTassabile = Math.max(0, plusvalenzeTotali - minusvalenzeTotali)
  const fiscale: EfficienzaFiscale = {
    plusvalenzeTotali, minusvalenzeTotali, nettoTassabile,
    impostaStimata: nettoTassabile * (DEFAULT_TASSAZIONE_INTERESSI / 100),
  }

  return {
    anno: input.anno, situazione, risparmioInvestimento: risparmioInvestimento,
    allocazione, spese, trend, concentrazione, runway, fire, fiscale,
  }
}
