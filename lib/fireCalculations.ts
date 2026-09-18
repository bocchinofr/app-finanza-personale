// lib/fireCalculations.ts
// Logica pura per il modulo FIRE. Nessuna dipendenza da Supabase/React:
// riceve parametri già aggregati e restituisce dati pronti per la UI.
//
// Modello a due fasi, in un'unica proiezione continua:
//  - ACCUMULO: da oggi finché il patrimonio non è sufficiente a sostenere il
//    decumulo fino a fine orizzonte. Si investe ogni anno (investimentoAnnuo),
//    le spese non intaccano il capitale (si assume coperte dal reddito da
//    lavoro).
//  - DECUMULO: dall'anno successivo al raggiungimento del FIRE (o da subito,
//    per lo scenario "runway"/"se smettessi oggi"). Niente più investimento:
//    le spese nette vengono prelevate dal capitale ogni anno.
//
// "FIRE raggiunto" NON è più un semplice rapporto (patrimonio >= spese/SWR):
// è una verifica di sostenibilità simulata. Ogni anno, mentre sei ancora in
// accumulo, si testa "se da qui in poi smettessi di investire, il capitale
// arriverebbe vivo a fine orizzonte?" simulando in avanti un intero decumulo
// con le tue assunzioni reali (rendimento, tasse, inflazione, crescita
// spese, sblocco fondo pensione). Il FIRE number (spese/SWR) resta calcolato
// e mostrato come riferimento — è il target "storico" della regola del 4% —
// ma non è più ciò che determina il passaggio da accumulo a decumulo.
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
  swrPct: number; // safe withdrawal rate, es. 4 — usato solo per il "fireNumberTarget" di riferimento
  tassazioneInteressiPct: number; // es. 26 (aliquota rendite finanziarie IT), editabile
  tassazioneFondoPensionePct: number; // es. 15 (agevolata, scende fino a 9% con anzianità), editabile

  debiti: Debito[];

  orizzonteAnni: number; // quanti anni proiettare (default 50) — orizzonte su cui si verifica la sostenibilità
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
  fireNumberTarget: number; // target di riferimento (spese nette / SWR) — regola del 4%, non più il trigger
  patrimonioRilevantePerFire: number; // investito (+ fondo se ancora bloccato e incluso da parametro)
  fireRaggiunto: boolean; // sostenibilità simulata fino a fine orizzonte, non più il rapporto spese/SWR
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

interface StatoSimulazione {
  patrimonioInvestito: number;
  fondoPensione: number;
  fondoGiaRitirato: boolean;
  integrazionePensioneAnnua: number;
}

/** Un singolo passo annuale del motore di simulazione: aggiorna lo stato e
 * produce i dati dell'anno. `fireRaggiunto` nel risultato NON è impostato
 * (lo decide il chiamante, in base alla modalità) — qui vale sempre false. */
function simulaUnAnno(
  params: FireParametri,
  stato: StatoSimulazione,
  i: number, // indice assoluto rispetto ad annoIniziale
  orizzonte: number,
  inAccumulo: boolean
): { stato: StatoSimulazione; annoInfo: AnnoProiezione } {
  const anno = params.annoIniziale + i;
  const eta = params.etaIniziale + i;

  let { patrimonioInvestito, fondoPensione, fondoGiaRitirato, integrazionePensioneAnnua } = stato;

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

  const fireNumberTarget = speseAnnue / (params.swrPct / 100);
  const capitaleEsaurito = !inAccumulo && patrimonioRilevantePerFire <= 0;

  const nuovoStato: StatoSimulazione = {
    patrimonioInvestito,
    fondoPensione,
    fondoGiaRitirato,
    integrazionePensioneAnnua,
  };

  return {
    stato: nuovoStato,
    annoInfo: {
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
      fireRaggiunto: false,
      integrazionePensioneAnnua,
      fondoPensioneRitirato: fondoGiaRitirato,
      capitaleEsaurito,
    },
  };
}

/** Verifica se, partendo dallo stato raggiunto all'indice iSoglia, un decumulo
 * dall'anno successivo fino a fine orizzonte sopravviverebbe (mai <= 0). */
function sostenibileFinoAFineOrizzonte(
  params: FireParametri,
  statoAllaSoglia: StatoSimulazione,
  iSoglia: number,
  orizzonte: number
): boolean {
  let stato = statoAllaSoglia;
  for (let j = iSoglia + 1; j < orizzonte; j++) {
    const passo = simulaUnAnno(params, stato, j, orizzonte, false);
    stato = passo.stato;
    if (passo.annoInfo.capitaleEsaurito) return false;
  }
  return true;
}

interface OpzioniSimulazione {
  modalita: "auto" | "decumulo_immediato";
  includiFondoPensione: boolean; // false = il fondo pensione viene ignorato per l'intera simulazione
}

/** Motore principale di proiezione, condiviso da calcolaProiezioneFire e calcolaRunway. */
function simulaProiezione(
  params: FireParametri,
  opzioni: OpzioniSimulazione
): AnnoProiezione[] {
  const orizzonte = params.orizzonteAnni ?? DEFAULT_ORIZZONTE;
  const risultati: AnnoProiezione[] = [];

  let stato: StatoSimulazione = {
    patrimonioInvestito: params.patrimonioLiquidoIniziale,
    fondoPensione: opzioni.includiFondoPensione ? params.fondoPensioneIniziale : 0,
    fondoGiaRitirato: !opzioni.includiFondoPensione,
    integrazionePensioneAnnua: 0,
  };
  let fireGiaRaggiunto = false;

  for (let i = 0; i < orizzonte; i++) {
    const inAccumulo: boolean = opzioni.modalita === "auto" && !fireGiaRaggiunto;

    const passo = simulaUnAnno(params, stato, i, orizzonte, inAccumulo);
    stato = passo.stato;

    let fireRaggiunto: boolean = fireGiaRaggiunto;
    if (opzioni.modalita === "auto" && inAccumulo && !fireGiaRaggiunto) {
      // Ancora in accumulo: verifica se da qui in poi il decumulo reggerebbe
      // fino a fine orizzonte con le assunzioni reali (non il rapporto SWR).
      fireRaggiunto = sostenibileFinoAFineOrizzonte(params, stato, i, orizzonte);
    }
    fireGiaRaggiunto = fireRaggiunto;

    risultati.push({ ...passo.annoInfo, fireRaggiunto });
  }

  return risultati;
}

/** Proiezione principale: accumulo finché il decumulo simulato non regge fino
 * a fine orizzonte, poi decumulo automatico. */
export function calcolaProiezioneFire(params: FireParametri): AnnoProiezione[] {
  return simulaProiezione(params, { modalita: "auto", includiFondoPensione: true });
}

export interface FireNumberResult {
  fireNumberOggi: number; // riferimento regola del 4%: spese attuali / SWR (non più il trigger)
  annoStimato: number | null; // null se la sostenibilità non viene raggiunta entro l'orizzonte
  etaStimata: number | null;
  anniMancanti: number | null;
}

/** Estrae dal risultato della proiezione il primo anno in cui la sostenibilità
 * simulata è raggiunta. */
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
  applicabile: boolean; // false se la sostenibilità non viene raggiunta entro l'orizzonte
  sostenibileFinoOrizzonte: boolean;
  annoEsaurimento: number | null;
  etaEsaurimento: number | null;
  anniDiRendita: number | null; // anni coperti dal pensionamento all'esaurimento (se si esaurisce)
}

/** Cosa succede DOPO il raggiungimento del FIRE: quanto dura il capitale nella
 * fase di decumulo. Con la nuova definizione di "raggiunto" questo risulterà
 * quasi sempre sostenibile per costruzione (è proprio ciò che è stato
 * verificato); resta utile per mostrare i dettagli e per i casi limite in cui
 * i parametri vengono modificati dopo il fatto. */
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
 * l'anno richiesto.
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
