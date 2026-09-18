// lib/fireCalculations.ts
// Logica pura per il modulo FIRE. Nessuna dipendenza da Supabase/React:
// riceve parametri già aggregati e restituisce dati pronti per la UI.
//
// Modello a due fasi, in un'unica proiezione continua:
//  - ACCUMULO: da oggi finché il patrimonio non raggiunge il FIRE number.
//    Si investe ogni anno (investimentoAnnuo), le spese non intaccano il
//    capitale (si assume coperte dal reddito da lavoro).
//  - DECUMULO: dall'anno successivo al raggiungimento del FIRE number (o da
//    subito, per lo scenario "runway"/"se smettessi oggi"). Niente più
//    investimento: le spese nette vengono prelevate dal capitale ogni anno.
//
// Il fondo pensione è un capitale separato, bloccato fino a
// etaRitiroFondoPensione: fino a quel momento cresce ma non è disponibile.
// Al raggiungimento dell'età si "sblocca" e si divide in due:
//  - una quota una tantum (tipo TFR) che confluisce nel patrimonio investito
//  - il resto come integrazione annua che riduce le spese nette da coprire
// Da quel momento il fondo pensione stesso (come voce a parte) si azzera e
// non genera più rendimento proprio: la quota capitale, una volta confluita
// nel patrimonio investito, segue invece il rendimento generale.

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
  crescitaSpesePct: number; // 0 = costanti, altrimenti % annua (default consigliato: inflazione)

  investimentoAnnuoBase: number; // capacità di investimento annua attuale (solo fase accumulo)
  crescitaInvestimentoPct: number; // 0 = costante

  patrimonioLiquidoIniziale: number; // liquidità + portafoglio investito
  rendimentoInvestimentiPct: number; // rendimento atteso annuo su patrimonio investito

  fondoPensioneIniziale: number;
  rendimentoFondoPensionePct: number; // rendimento finché il fondo resta bloccato
  includiFondoPensioneInFireNumber: boolean; // se il fondo ANCORA BLOCCATO conta ai fini del target FIRE

  etaRitiroFondoPensione: number; // età a cui il fondo si sblocca (default 67, editabile)
  quotaCapitaleFondoPensionePct: number; // % del fondo che esce come capitale una tantum (TFR); il resto come integrazione annua

  inflazionePct: number; // usata come riferimento, non applicata automaticamente alle spese
  swrPct: number; // safe withdrawal rate, es. 4
  tassazioneInteressiPct: number; // es. 26 (aliquota rendite finanziarie IT), editabile
  tassazioneFondoPensionePct: number; // es. 15 (agevolata, scende fino a 9% con anzianità), editabile

  debiti: Debito[];

  orizzonteAnni: number; // quanti anni proiettare (default 50)
}

export interface AnnoProiezione {
  anno: number;
  eta: number;
  fase: "accumulo" | "decumulo";
  speseAnnue: number; // nette: dopo rate debiti estinte e integrazione pensione
  investimentoAnnuo: number; // 0 in fase decumulo
  patrimonioInvestito: number; // fine anno
  fondoPensione: number; // fine anno (0 dopo lo sblocco)
  patrimonioTotale: number; // investito + fondo pensione (per grafico)
  fireNumberTarget: number; // target dell'anno (spese nette / SWR)
  patrimonioRilevantePerFire: number; // investito (+ fondo se ancora bloccato e incluso da parametro)
  fireRaggiunto: boolean;
  integrazionePensioneAnnua: number; // 0 finché il fondo non si sblocca
  fondoPensioneRitirato: boolean;
  capitaleEsaurito: boolean; // patrimonio rilevante <= 0 in fase decumulo
}

const DEFAULT_ORIZZONTE = 50;

/** Rendimento netto dopo tassazione sugli interessi/plusvalenze. */
function rendimentoNetto(rendimentoLordoPct: number, tassazionePct: number): number {
  return rendimentoLordoPct * (1 - tassazionePct / 100);
}

/** Spese annue dell'anno, dopo aver tolto le rate dei debiti già estinti (le rate
 * sono già incluse in speseBase: si sottraggono solo quando il debito risulta
 * estinto nell'anno corrente). Non considera ancora l'integrazione pensionistica. */
function speseDopoEstinzioneDebiti(
  speseBase: number,
  crescitaPct: number,
  annoIndex: number,
  anno: number,
  debiti: Debito[]
): number {
  const speseLorde = speseBase * Math.pow(1 + crescitaPct / 100, annoIndex);
  const rateEstinteEntroAnno = debiti
    .filter((d) => anno >= d.annoEstinzione)
    .reduce((sum, d) => sum + d.rataAnnua, 0);
  return speseLorde - rateEstinteEntroAnno;
}

interface OpzioniSimulazione {
  modalita: "auto" | "decumulo_immediato";
  includiFondoPensione: boolean; // false = il fondo pensione viene ignorato per l'intera simulazione
}

/** Motore unico di proiezione, condiviso da calcolaProiezioneFire e calcolaRunway. */
function simulaProiezione(
  params: FireParametri,
  opzioni: OpzioniSimulazione
): AnnoProiezione[] {
  const orizzonte = params.orizzonteAnni ?? DEFAULT_ORIZZONTE;
  const risultati: AnnoProiezione[] = [];

  let patrimonioInvestito = params.patrimonioLiquidoIniziale;
  let fondoPensione = opzioni.includiFondoPensione ? params.fondoPensioneIniziale : 0;
  let fondoGiaRitirato = !opzioni.includiFondoPensione;
  let fireGiaRaggiunto = false;
  let integrazionePensioneAnnua = 0;

  for (let i = 0; i < orizzonte; i++) {
    const anno = params.annoIniziale + i;
    const eta = params.etaIniziale + i;

    const inAccumulo: boolean = opzioni.modalita === "auto" && !fireGiaRaggiunto;

    // --- Fondo pensione: sblocco a età, oppure crescita mentre resta bloccato ---
    if (!fondoGiaRitirato) {
      if (eta >= params.etaRitiroFondoPensione) {
        const capitaleTFR = fondoPensione * (params.quotaCapitaleFondoPensionePct / 100);
        const integrazioneTotale =
          fondoPensione * (1 - params.quotaCapitaleFondoPensionePct / 100);
        const anniResidui = orizzonte - i;
        integrazionePensioneAnnua = anniResidui > 0 ? integrazioneTotale / anniResidui : 0;
        patrimonioInvestito += capitaleTFR;
        fondoPensione = 0;
        fondoGiaRitirato = true;
      } else {
        const rendimentoFondoNetto = rendimentoNetto(
          params.rendimentoFondoPensionePct,
          params.tassazioneFondoPensionePct
        );
        fondoPensione = fondoPensione * (1 + rendimentoFondoNetto / 100);
      }
    }

    // --- Spese nette: dopo debiti estinti e integrazione pensione già attiva ---
    const speseDopoDebiti = speseDopoEstinzioneDebiti(
      params.speseAnnueBase,
      params.crescitaSpesePct,
      i,
      anno,
      params.debiti
    );
    const speseAnnue = Math.max(0, speseDopoDebiti - integrazionePensioneAnnua);

    // --- Investimento annuo: solo in fase di accumulo ---
    const investimentoAnnuo: number = inAccumulo
      ? params.investimentoAnnuoBase * Math.pow(1 + params.crescitaInvestimentoPct / 100, i)
      : 0;

    // --- Patrimonio investito: accumula in fase accumulo, si consuma in decumulo ---
    const rendimentoInvestitiNetto = rendimentoNetto(
      params.rendimentoInvestimentiPct,
      params.tassazioneInteressiPct
    );
    patrimonioInvestito = inAccumulo
      ? patrimonioInvestito * (1 + rendimentoInvestitiNetto / 100) + investimentoAnnuo
      : patrimonioInvestito * (1 + rendimentoInvestitiNetto / 100) - speseAnnue;

    const patrimonioRilevantePerFire = params.includiFondoPensioneInFireNumber
      ? patrimonioInvestito + fondoPensione
      : patrimonioInvestito;

    // Target espresso sulle spese nette dell'anno (già al netto di debiti estinti
    // e integrazione pensione): rappresenta il capitale che serve OGGI per quel
    // livello di spesa secondo lo SWR scelto.
    const fireNumberTarget = speseAnnue / (params.swrPct / 100);

    const fireRaggiunto: boolean =
      fireGiaRaggiunto || patrimonioRilevantePerFire >= fireNumberTarget;
    fireGiaRaggiunto = fireRaggiunto;

    const capitaleEsaurito = !inAccumulo && patrimonioRilevantePerFire <= 0;

    risultati.push({
      anno,
      eta,
      fase: inAccumulo ? "accumulo" : "decumulo",
      speseAnnue,
      investimentoAnnuo,
      patrimonioInvestito,
      fondoPensione,
      patrimonioTotale: patrimonioInvestito + fondoPensione,
      fireNumberTarget,
      patrimonioRilevantePerFire,
      fireRaggiunto,
      integrazionePensioneAnnua,
      fondoPensioneRitirato: fondoGiaRitirato,
      capitaleEsaurito,
    });
  }

  return risultati;
}

/** Proiezione principale: accumulo fino al FIRE number, poi decumulo automatico. */
export function calcolaProiezioneFire(params: FireParametri): AnnoProiezione[] {
  return simulaProiezione(params, { modalita: "auto", includiFondoPensione: true });
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

export interface PostFireResult {
  applicabile: boolean; // false se il FIRE non viene raggiunto entro l'orizzonte
  sostenibileFinoOrizzonte: boolean;
  annoEsaurimento: number | null;
  etaEsaurimento: number | null;
  anniDiRendita: number | null; // anni coperti dal pensionamento all'esaurimento (se si esaurisce)
}

/** Cosa succede DOPO il raggiungimento del FIRE number: quanto dura il capitale
 * nella fase di decumulo, tenendo conto anche dello sblocco del fondo pensione. */
export function calcolaSostenibilitaPostFire(
  proiezione: AnnoProiezione[],
  fireNumberResult: FireNumberResult
): PostFireResult {
  if (fireNumberResult.annoStimato === null) {
    return {
      applicabile: false,
      sostenibileFinoOrizzonte: false,
      annoEsaurimento: null,
      etaEsaurimento: null,
      anniDiRendita: null,
    };
  }

  const annoEsaurimento = proiezione.find((a) => a.fase === "decumulo" && a.capitaleEsaurito);

  if (!annoEsaurimento) {
    return {
      applicabile: true,
      sostenibileFinoOrizzonte: true,
      annoEsaurimento: null,
      etaEsaurimento: null,
      anniDiRendita: null,
    };
  }

  return {
    applicabile: true,
    sostenibileFinoOrizzonte: false,
    annoEsaurimento: annoEsaurimento.anno,
    etaEsaurimento: annoEsaurimento.eta,
    anniDiRendita: annoEsaurimento.anno - fireNumberResult.annoStimato,
  };
}

export interface RunwayResult {
  sostenibileIndefinitamente: boolean;
  annoEsaurimento: number | null;
  etaEsaurimento: number | null;
  anniDiAutonomia: number | null;
}

/**
 * Calcola quanto dura il patrimonio se si smette di lavorare OGGI (decumulo
 * immediato, niente fase di accumulo). Il fondo pensione, se incluso, si
 * sblocca comunque solo al raggiungimento di etaRitiroFondoPensione durante
 * la proiezione: prima di allora non è disponibile per coprire le spese.
 */
export function calcolaRunway(
  params: FireParametri,
  includiFondoPensione: boolean = false
): RunwayResult {
  const proiezione = simulaProiezione(params, {
    modalita: "decumulo_immediato",
    includiFondoPensione,
  });

  const esaurito = proiezione.find((a) => a.capitaleEsaurito);

  if (!esaurito) {
    return {
      sostenibileIndefinitamente: true,
      annoEsaurimento: null,
      etaEsaurimento: null,
      anniDiAutonomia: null,
    };
  }

  return {
    sostenibileIndefinitamente: false,
    annoEsaurimento: esaurito.anno,
    etaEsaurimento: esaurito.eta,
    anniDiAutonomia: esaurito.anno - params.annoIniziale,
  };
}

export interface ConfrontoAnnuale {
  anno: number;
  speseReali: number;
  speseSimulate: number;
  investimentoReale: number;
  investimentoSimulato: number;
  patrimonioReale: number;
  patrimonioSimulato: number;
  scostamentoPatrimonioPct: number; // (reale - simulato) / |simulato| * 100
}

/**
 * Confronta i dati reali correnti (spese/investimento annualizzati, patrimonio
 * di oggi) con quanto previsto per lo stesso anno da uno snapshot congelato in
 * precedenza (fire_snapshot). Restituisce null se lo snapshot non copre
 * l'anno richiesto (non dovrebbe succedere se lo snapshot è stato creato per
 * quell'anno o per uno precedente con orizzonte sufficiente).
 */
export function confrontaConSnapshot(
  annoTarget: number,
  proiezioneSnapshot: AnnoProiezione[],
  attuale: { speseReali: number; investimentoReale: number; patrimonioReale: number }
): ConfrontoAnnuale | null {
  const annoDati = proiezioneSnapshot.find((a) => a.anno === annoTarget);
  if (!annoDati) return null;

  const patrimonioSimulato = annoDati.patrimonioRilevantePerFire;
  const scostamentoPatrimonioPct =
    patrimonioSimulato !== 0
      ? ((attuale.patrimonioReale - patrimonioSimulato) / Math.abs(patrimonioSimulato)) * 100
      : 0;

  return {
    anno: annoTarget,
    speseReali: attuale.speseReali,
    speseSimulate: annoDati.speseAnnue,
    investimentoReale: attuale.investimentoReale,
    investimentoSimulato: annoDati.investimentoAnnuo,
    patrimonioReale: attuale.patrimonioReale,
    patrimonioSimulato,
    scostamentoPatrimonioPct,
  };
}
