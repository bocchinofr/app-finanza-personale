// lib/fireCalculations.ts
// Logica pura per il modulo FIRE. Nessuna dipendenza da Supabase/React:
// riceve parametri già aggregati e restituisce dati pronti per la UI.

export interface Debito {
  id: string;
  nome: string; // es. "Mutuo casa"
  rataAnnua: number; // importo che si libera ad estinzione
  annoEstinzione: number; // anno solare in cui la rata si azzera
}

export interface FireParametri {
  annoIniziale: number; // anno corrente
  etaIniziale: number; // calcolata da data_nascita profilo

  speseAnnueBase: number; // media spese annue attuali (comprensive di rate debiti)
  crescitaSpesePct: number; // 0 = costanti, altrimenti % annua (es. inflazione)

  investimentoAnnuoBase: number; // capacità di investimento annua attuale
  crescitaInvestimentoPct: number; // 0 = costante

  patrimonioLiquidoIniziale: number; // liquidità + portafoglio investito
  rendimentoInvestimentiPct: number; // rendimento atteso annuo su patrimonio investito

  fondoPensioneIniziale: number;
  rendimentoFondoPensionePct: number;
  includiFondoPensioneInFireNumber: boolean; // se escluso, cresce ma non conta ai fini SWR

  inflazionePct: number; // usata per il target di spesa "reale" nel FIRE number
  swrPct: number; // safe withdrawal rate, es. 4
  tassazioneInteressiPct: number; // es. 26 (aliquota rendite finanziarie IT), editabile
  tassazioneFondoPensionePct: number; // es. 15 (agevolata, scende fino a 9% con anzianità), editabile

  debiti: Debito[];

  orizzonteAnni: number; // quanti anni proiettare (default 50)
}

export interface AnnoProiezione {
  anno: number;
  eta: number;
  speseAnnue: number; // già al netto delle rate estinte
  investimentoAnnuo: number;
  patrimonioInvestito: number; // fine anno
  fondoPensione: number; // fine anno
  patrimonioTotale: number; // investito + fondo pensione (per grafico)
  fireNumberTarget: number; // target dell'anno (spese annue / SWR)
  patrimonioRilevantePerFire: number; // investito (+ fondo se incluso)
  fireRaggiunto: boolean;
}

const DEFAULT_ORIZZONTE = 50;

/** Rendimento netto dopo tassazione sugli interessi/plusvalenze. */
function rendimentoNetto(rendimentoLordoPct: number, tassazionePct: number): number {
  return rendimentoLordoPct * (1 - tassazionePct / 100);
}

/** Spese annue nette dell'anno, dopo aver tolto le rate dei debiti già estinti. */
function speseNetteAnno(
  speseBase: number,
  crescitaPct: number,
  annoIndex: number,
  anno: number,
  debiti: Debito[]
): number {
  const speseLorde = speseBase * Math.pow(1 + crescitaPct / 100, annoIndex);
  // Le rate sono già incluse in speseBase (spesa storica reale).
  // Si sottrae la rata SOLO quando il debito risulta estinto nell'anno corrente.
  const rateEstinteEntroAnno = debiti
    .filter((d) => anno >= d.annoEstinzione)
    .reduce((sum, d) => sum + d.rataAnnua, 0);

  return speseLorde - rateEstinteEntroAnno;
}

/** Genera la proiezione anno per anno fino a orizzonteAnni o fino a FIRE raggiunto + qualche anno. */
export function calcolaProiezioneFire(params: FireParametri): AnnoProiezione[] {
  const orizzonte = params.orizzonteAnni ?? DEFAULT_ORIZZONTE;
  const risultati: AnnoProiezione[] = [];

  let patrimonioInvestito = params.patrimonioLiquidoIniziale;
  let fondoPensione = params.fondoPensioneIniziale;
  let fireGiaRaggiunto = false;

  for (let i = 0; i < orizzonte; i++) {
    const anno = params.annoIniziale + i;
    const eta = params.etaIniziale + i;

    const speseAnnue = speseNetteAnno(
      params.speseAnnueBase,
      params.crescitaSpesePct,
      i,
      anno,
      params.debiti
    );

    const investimentoAnnuo =
      params.investimentoAnnuoBase * Math.pow(1 + params.crescitaInvestimentoPct / 100, i);

    // Crescita del patrimonio investito: rendimento NETTO sul capitale + nuovo investimento nell'anno
    const rendimentoInvestitiNetto = rendimentoNetto(
      params.rendimentoInvestimentiPct,
      params.tassazioneInteressiPct
    );
    patrimonioInvestito = patrimonioInvestito * (1 + rendimentoInvestitiNetto / 100) + investimentoAnnuo;

    // Fondo pensione: tassazione agevolata propria, aliquota separata editabile.
    const rendimentoFondoNetto = rendimentoNetto(
      params.rendimentoFondoPensionePct,
      params.tassazioneFondoPensionePct
    );
    fondoPensione = fondoPensione * (1 + rendimentoFondoNetto / 100);

    const patrimonioRilevantePerFire = params.includiFondoPensioneInFireNumber
      ? patrimonioInvestito + fondoPensione
      : patrimonioInvestito;

    // Target espresso in termini reali: le spese annue sono già proiettate con la loro
    // crescita propria (es. inflazione), quindi il target è semplicemente spese/SWR.
    const fireNumberTarget = speseAnnue / (params.swrPct / 100);

    const fireRaggiunto =
      fireGiaRaggiunto || patrimonioRilevantePerFire >= fireNumberTarget;
    fireGiaRaggiunto = fireRaggiunto;

    risultati.push({
      anno,
      eta,
      speseAnnue,
      investimentoAnnuo,
      patrimonioInvestito,
      fondoPensione,
      patrimonioTotale: patrimonioInvestito + fondoPensione,
      fireNumberTarget,
      patrimonioRilevantePerFire,
      fireRaggiunto,
    });
  }

  return risultati;
}

export interface FireNumberResult {
  fireNumberOggi: number; // target calcolato su spese attuali (anno 0)
  annoStimato: number | null; // null se non raggiunto entro orizzonte
  etaStimata: number | null;
  anniMancanti: number | null;
}

/** Estrae dal risultato della proiezione il primo anno in cui il FIRE è raggiunto. */
export function calcolaFireNumber(
  proiezione: AnnoProiezione[],
  params: FireParametri
): FireNumberResult {
  const fireNumberOggi = params.speseAnnueBase / (params.swrPct / 100);
  const annoRaggiungimento = proiezione.find((a) => a.fireRaggiunto);

  if (!annoRaggiungimento) {
    return {
      fireNumberOggi,
      annoStimato: null,
      etaStimata: null,
      anniMancanti: null,
    };
  }

  return {
    fireNumberOggi,
    annoStimato: annoRaggiungimento.anno,
    etaStimata: annoRaggiungimento.eta,
    anniMancanti: annoRaggiungimento.anno - params.annoIniziale,
  };
}

export interface RunwayResult {
  sostenibileIndefinitamente: boolean;
  annoEsaurimento: number | null;
  etaEsaurimento: number | null;
  anniDiAutonomia: number | null;
}

/**
 * Calcola quanto dura il patrimonio se si smette di lavorare OGGI:
 * niente nuovo investimento, si vive di rendita/decumulo.
 * Il fondo pensione è escluso di default (spesso non liquidabile subito):
 * passare includiFondoPensione=true per considerarlo comunque disponibile.
 */
export function calcolaRunway(
  params: FireParametri,
  includiFondoPensione: boolean = false
): RunwayResult {
  const orizzonte = params.orizzonteAnni ?? DEFAULT_ORIZZONTE;

  let patrimonio =
    params.patrimonioLiquidoIniziale +
    (includiFondoPensione ? params.fondoPensioneIniziale : 0);

  const rendimentoInvestitiNetto = rendimentoNetto(
    params.rendimentoInvestimentiPct,
    params.tassazioneInteressiPct
  );
  const rendimentoFondoNetto = rendimentoNetto(
    params.rendimentoFondoPensionePct,
    params.tassazioneFondoPensionePct
  );
  const rendimentoMedioPct = includiFondoPensione
    ? (rendimentoInvestitiNetto + rendimentoFondoNetto) / 2
    : rendimentoInvestitiNetto;

  for (let i = 0; i < orizzonte; i++) {
    const anno = params.annoIniziale + i;
    const eta = params.etaIniziale + i;

    const speseAnnue = speseNetteAnno(
      params.speseAnnueBase,
      params.inflazionePct, // in decumulo le spese seguono l'inflazione reale, non un'ipotesi separata
      i,
      anno,
      params.debiti
    );

    patrimonio = patrimonio * (1 + rendimentoMedioPct / 100) - speseAnnue;

    if (patrimonio <= 0) {
      return {
        sostenibileIndefinitamente: false,
        annoEsaurimento: anno,
        etaEsaurimento: eta,
        anniDiAutonomia: i,
      };
    }
  }

  return {
    sostenibileIndefinitamente: true,
    annoEsaurimento: null,
    etaEsaurimento: null,
    anniDiAutonomia: null,
  };
}
