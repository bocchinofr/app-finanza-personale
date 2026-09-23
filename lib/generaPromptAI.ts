// lib/generaPromptAI.ts
// Costruisce un prompt testuale, già compilato con i numeri reali, da incollare
// in un'AI esterna per ottenere un'analisi esperta della situazione finanziaria.

import { AnalisiFinanziaria } from './analisiCalculations'

function euro(n: number): string {
  return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}
function pct(n: number | null, decimali = 1): string {
  return n === null ? 'N/D' : `${n.toFixed(decimali)}%`
}

export function generaPromptAI(a: AnalisiFinanziaria): string {
  const { situazione: s, risparmioInvestimento: ri, allocazione: al, spese, trend, concentrazione, runway, fire, fiscale } = a

  const righeSpese = spese.principali
    .map(c => `  - ${c.categoria}: ${euro(c.totale)} (${pct(c.pctSuTotale)} delle uscite totali)${c.superflua ? ' [superflua]' : ''}`)
    .join('\n')

  const rs = spese.riduzioneSuperflue
  const righeSuperflue = rs.categorie
    .map(c => `  - ${c.categoria}: ${euro(c.totale)}`)
    .join('\n')

  const righeConcentrazione = concentrazione.top3
    .map(t => `  - ${t.nome}: ${euro(t.valore)} (${pct(t.pct)} del portafoglio)`)
    .join('\n')

  return `Sono un investitore/risparmiatore italiano e ti chiedo un'analisi esperta della mia situazione finanziaria per l'anno ${a.anno}. Ecco i dati:

## 1. Situazione attuale
- Entrate annue: ${euro(s.entrateAnnue)}
- Uscite annue: ${euro(s.usciteAnnue)}
- Risparmio annuo (entrate - uscite): ${euro(s.risparmioAnnuo)}
- Investito nell'anno: ${euro(s.investimentiAnnui)}
- Liquidità attuale: ${euro(s.liquiditaAttuale)}
- Capitale investito (valore di mercato): ${euro(s.capitaleInvestitoMercato)}
- Plus/minusvalenze non realizzate: ${euro(s.pnlNonRealizzato)}
- Fondo pensione: ${euro(s.fondoPensioneAttuale)}
- Patrimonio netto totale: ${euro(s.patrimonioNetto)}

## 2. Risparmio vs investimento
- Tasso di risparmio: ${pct(ri.tassoRisparmioPct)} delle entrate
- Quota del risparmio effettivamente investita: ${pct(ri.quotaRisparmioInvestitaPct)}
- Buffer di liquidità considerato prudente: ${ri.bufferMesiUsato} mesi di spese (${euro(ri.bufferConsigliato)})
- Capitale liquido fermo oltre il buffer: ${euro(ri.capitaleFermoOltreBuffer)}

## 3. Allocazione azionario/obbligazionario
- Azionario: ${euro(al.valoreAzionario)} (${pct(al.pctAzionario)})
- Obbligazionario: ${euro(al.valoreObbligazionario)} (${pct(al.pctObbligazionario)})
- Altro/non classificato: ${euro(al.valoreAltro)}
- Capitale libero disponibile per nuovo accumulo (asset svincolati + liquidità in eccesso): ${euro(al.capitaleLiberoPerAccumulo)}

## 4. Spese per categoria (principali voci)
${righeSpese || '  (nessuna spesa registrata)'}

## 4bis. Spese superflue e potenziale di risparmio investibile
Categorie classificate come discrezionali/comprimibili (RISTORANTI, TEMPO LIBERO, ABBIGLIAMENTO, AMAZON & CO, VACANZE):
${righeSuperflue || '  (nessuna spesa in queste categorie)'}
- Totale spese superflue: ${euro(rs.totaleSuperflue)}
- Ipotesi di riduzione: ${rs.pctIpotesiRiduzione}% → risparmio potenziale annuo: ${euro(rs.risparmioPotenzialeAnnuo)}
- Se questo risparmio venisse investito ogni anno per ${rs.orizzonteProiezioneAnni} anni al rendimento medio ipotizzato (6%): ${euro(rs.valoreSeInvestito)}

## 5. Trend recente
- Ultimo mese con dati: ${trend.meseRecente ?? 'N/D'}
- Spese ultimo mese: ${euro(trend.speseMeseRecente)} vs media mesi precedenti ${trend.speseMediaPrecedenti !== null ? euro(trend.speseMediaPrecedenti) : 'N/D'} (variazione: ${pct(trend.deltaSpesePct)})
- Investimenti ultimo mese: ${euro(trend.investimentiMeseRecente)} vs media mesi precedenti ${trend.investimentiMediaPrecedenti !== null ? euro(trend.investimentiMediaPrecedenti) : 'N/D'} (variazione: ${pct(trend.deltaInvestimentiPct)})

## 6. Concentrazione portafoglio
${righeConcentrazione || '  (nessun asset in portafoglio)'}
- Peso dell'asset principale: ${pct(concentrazione.pesoPrincipalePct)}

## 7. Runway di liquidità
- Mesi di spese coperti dalla sola liquidità attuale: ${runway.mesiCoperti !== null ? runway.mesiCoperti.toFixed(1) : 'N/D'}

## 8. Traiettoria FIRE (stima con assunzioni prudenziali standard: rendimento 6%, inflazione 2%, SWR 4%)
${fire.disponibile
    ? `- Anno stimato di raggiungimento sostenibilità: ${fire.annoStimato ?? 'oltre l\'orizzonte di proiezione'} ${fire.anniMancanti !== null ? `(tra ${fire.anniMancanti} anni, età ${fire.etaStimata})` : ''}`
    : '- Dati insufficienti per una stima (mancano uscite annue registrate)'}

## 9. Efficienza fiscale
- Plusvalenze non realizzate: ${euro(fiscale.plusvalenzeTotali)}
- Minusvalenze non realizzate: ${euro(fiscale.minusvalenzeTotali)}
- Netto potenzialmente tassabile: ${euro(fiscale.nettoTassabile)}
- Imposta stimata se realizzato oggi (26%): ${euro(fiscale.impostaStimata)}

---
In base a questi dati, vorrei una tua analisi su:
1. Se la mia capacità di risparmio è ben sfruttata o se sto lasciando troppo capitale fermo che potrebbe essere investito
2. Se l'allocazione azionario/obbligazionario è coerente con un orizzonte di lungo termine o andrebbe rivista
3. Quali categorie di spesa hanno il maggiore impatto e dove potrei ragionevolmente tagliare
4. Se il livello di concentrazione del portafoglio rappresenta un rischio da correggere
5. Se ci sono azioni di ottimizzazione fiscale sensate da valutare (es. compensazione minus/plus) — dammi solo spunti generali, non consulenza fiscale personalizzata
6. Qualunque altra osservazione utile che noti nei numeri sopra

Rispondi in modo diretto e pratico, evidenziando le 2-3 azioni con il maggiore impatto.`
}
