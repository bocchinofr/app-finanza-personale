// Domande del questionario, ciascuna assegnata a una dimensione del profilo:
// - 'risk'          -> tolleranza al rischio / oscillazioni (score complessivo)
// - 'behavior'      -> reazione comportamentale ai crolli di mercato
// - 'diversification' -> preferenza di concentrazione vs diversificazione
// - 'allocation'    -> mix preferito azionario / obbligazionario
export type RiskDimension = 'risk' | 'behavior' | 'diversification' | 'allocation'

export const RISK_QUESTIONS: { id: string; label: string; dimension: RiskDimension; options: { value: number; label: string }[] }[] = [
  {
    id: 'horizon',
    label: 'Qual è il tuo orizzonte temporale per gli investimenti?',
    dimension: 'risk',
    options: [
      { value: 20, label: 'Breve termine (< 3 anni)' },
      { value: 50, label: 'Medio termine (3-10 anni)' },
      { value: 80, label: 'Lungo termine (> 10 anni)' },
    ]
  },
  {
    id: 'lossTolerance',
    label: 'Quanta oscillazione temporanea del portafoglio sei disposto a tollerare per rendimenti più alti?',
    dimension: 'risk',
    options: [
      { value: 10, label: 'Nessuna: preferisco stabilità anche con rendimenti bassi' },
      { value: 40, label: 'Moderata: accetto oscillazioni del 10-15%' },
      { value: 70, label: 'Alta: accetto oscillazioni del 20-30%' },
      { value: 95, label: 'Molto alta: accetto oscillazioni anche superiori al 30%' },
    ]
  },
  {
    id: 'reaction',
    label: 'Come reagiresti a un crollo del 20% del mercato?',
    dimension: 'behavior',
    options: [
      { value: 5, label: 'Venderei subito per fermare le perdite' },
      { value: 40, label: 'Aspetterei senza fare nulla' },
      { value: 70, label: 'Continuerei i versamenti programmati come da piano' },
      { value: 95, label: 'Approfitterei per investire di più (accumulo sui crolli)' },
    ]
  },
  {
    id: 'diversification',
    label: 'Preferisci un portafoglio molto diversificato o concentrato su poche scelte convinte?',
    dimension: 'diversification',
    options: [
      { value: 15, label: 'Concentrato su poche posizioni ad alta convinzione' },
      { value: 55, label: 'Bilanciato: poche posizioni principali + satelliti' },
      { value: 95, label: 'Molto diversificato: tanti asset, settori e aree geografiche' },
    ]
  },
  {
    id: 'allocation',
    label: 'Se potessi scegliere liberamente il mix, quale preferiresti?',
    dimension: 'allocation',
    options: [
      { value: 10, label: 'Prevalentemente obbligazionario / liquidità' },
      { value: 35, label: 'Prudente: più obbligazioni che azioni' },
      { value: 60, label: 'Bilanciato: metà azioni, metà obbligazioni' },
      { value: 80, label: 'Dinamico: più azioni che obbligazioni' },
      { value: 100, label: 'Prevalentemente azionario' },
    ]
  },
  {
    id: 'knowledge',
    label: 'Come valuti la tua conoscenza finanziaria?',
    dimension: 'risk',
    options: [
      { value: 20, label: 'Base (solo conto corrente e risparmio)' },
      { value: 50, label: 'Intermedia (fondi, obbligazioni, azioni)' },
      { value: 90, label: 'Avanzata (asset allocation, derivati, mercati)' },
    ]
  },
]
