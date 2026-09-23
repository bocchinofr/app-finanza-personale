// lib/generaReportTesto.ts
// Report testuale in italiano, pensato per la lettura diretta nel popup e per
// l'export PDF (solo testo, nessun grafico).

import { AnalisiFinanziaria } from './analisiCalculations'

function euro(n: number): string {
  return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}
function pct(n: number | null, decimali = 1): string {
  return n === null ? 'N/D' : `${n.toFixed(decimali)}%`
}

export interface SezioneReport {
  titolo: string
  righe: string[]
}

/** Struttura a sezioni, usata per il rendering nel popup (una card per sezione). */
export function generaSezioniReport(a: AnalisiFinanziaria): SezioneReport[] {
  const { situazione: s, risparmioInvestimento: ri, allocazione: al, spese, trend, concentrazione, runway, fire, fiscale } = a

  return [
    {
      titolo: 'Situazione attuale',
      righe: [
        `Entrate annue: ${euro(s.entrateAnnue)}`,
        `Uscite annue: ${euro(s.usciteAnnue)}`,
        `Risparmio annuo: ${euro(s.risparmioAnnuo)}`,
        `Investito nell'anno: ${euro(s.investimentiAnnui)}`,
        `Liquidità attuale: ${euro(s.liquiditaAttuale)}`,
        `Capitale investito (mercato): ${euro(s.capitaleInvestitoMercato)}`,
        `Plus/minusvalenze non realizzate: ${euro(s.pnlNonRealizzato)}`,
        `Fondo pensione: ${euro(s.fondoPensioneAttuale)}`,
        `Patrimonio netto totale: ${euro(s.patrimonioNetto)}`,
      ],
    },
    {
      titolo: 'Risparmio vs investimento',
      righe: [
        `Tasso di risparmio: ${pct(ri.tassoRisparmioPct)} delle entrate`,
        `Quota del risparmio investita: ${pct(ri.quotaRisparmioInvestitaPct)}`,
        `Buffer di liquidità prudente (${ri.bufferMesiUsato} mesi di spese): ${euro(ri.bufferConsigliato)}`,
        `Capitale fermo oltre il buffer: ${euro(ri.capitaleFermoOltreBuffer)}`,
      ],
    },
    {
      titolo: 'Azionario vs obbligazionario',
      righe: [
        `Azionario: ${euro(al.valoreAzionario)} (${pct(al.pctAzionario)})`,
        `Obbligazionario: ${euro(al.valoreObbligazionario)} (${pct(al.pctObbligazionario)})`,
        `Altro/non classificato: ${euro(al.valoreAltro)}`,
        `Capitale libero per nuovo accumulo: ${euro(al.capitaleLiberoPerAccumulo)}`,
      ],
    },
    {
      titolo: 'Spese per categoria (principali)',
      righe: spese.top3.length > 0
        ? spese.top3.map(c => `${c.categoria}: ${euro(c.totale)} (${pct(c.pctSuTotale)})`)
        : ['Nessuna spesa registrata'],
    },
    {
      titolo: 'Trend recente',
      righe: [
        `Ultimo mese con dati: ${trend.meseRecente ?? 'N/D'}`,
        `Spese: ${euro(trend.speseMeseRecente)} (media mesi precedenti: ${trend.speseMediaPrecedenti !== null ? euro(trend.speseMediaPrecedenti) : 'N/D'}, variazione ${pct(trend.deltaSpesePct)})`,
        `Investimenti: ${euro(trend.investimentiMeseRecente)} (media mesi precedenti: ${trend.investimentiMediaPrecedenti !== null ? euro(trend.investimentiMediaPrecedenti) : 'N/D'}, variazione ${pct(trend.deltaInvestimentiPct)})`,
      ],
    },
    {
      titolo: 'Concentrazione portafoglio',
      righe: concentrazione.top3.length > 0
        ? [
          ...concentrazione.top3.map(t => `${t.nome}: ${euro(t.valore)} (${pct(t.pct)})`),
          `Peso dell'asset principale: ${pct(concentrazione.pesoPrincipalePct)}`,
        ]
        : ['Nessun asset in portafoglio'],
    },
    {
      titolo: 'Runway di liquidità',
      righe: [
        `Mesi di spese coperti dalla liquidità attuale: ${runway.mesiCoperti !== null ? runway.mesiCoperti.toFixed(1) : 'N/D'}`,
      ],
    },
    {
      titolo: 'Traiettoria FIRE (stima con assunzioni prudenziali standard)',
      righe: fire.disponibile
        ? [fire.annoStimato !== null
            ? `Anno stimato di raggiungimento sostenibilità: ${fire.annoStimato} (tra ${fire.anniMancanti} anni, età ${fire.etaStimata})`
            : `Sostenibilità non raggiunta entro l'orizzonte di proiezione con il ritmo attuale`]
        : ['Dati insufficienti per una stima'],
    },
    {
      titolo: 'Efficienza fiscale',
      righe: [
        `Plusvalenze non realizzate: ${euro(fiscale.plusvalenzeTotali)}`,
        `Minusvalenze non realizzate: ${euro(fiscale.minusvalenzeTotali)}`,
        `Netto potenzialmente tassabile: ${euro(fiscale.nettoTassabile)}`,
        `Imposta stimata se realizzato oggi (26%): ${euro(fiscale.impostaStimata)}`,
      ],
    },
  ]
}
