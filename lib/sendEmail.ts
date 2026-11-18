import nodemailer from 'nodemailer'
import type { DettaglioAlert, DettaglioAsset } from '@/lib/alertDettaglio'

let transporter: nodemailer.Transporter | null = null

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    })
  }
  return transporter
}

export interface AlertEmailTrigger {
  tipoLabel: string
  sogliaPct: number
  drawdown: number
  numAttivazione: number
}

export interface AlertEmailRiga {
  nomeAsset: string
  trigger: AlertEmailTrigger[]
  importoConsigliato?: number
  nuovoPesoAzionario?: number
  dettaglio?: DettaglioAsset
}

function fmtEuro(n: number) {
  return `€${Math.round(n).toLocaleString('it-IT')}`
}


const fmtPct = (n: number, dec = 1) => `${n >= 0 ? '+' : ''}${n.toFixed(dec)}%`
const fmtPrezzo = (n: number) => `€${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const cella = 'padding: 3px 6px; font-size: 12px; border-bottom: 1px solid #eee;'

function margineTxt(m: number) {
  return m >= 0 ? `-${m.toFixed(1)}% dal prezzo attuale` : `già sotto PMC (${m.toFixed(1)}%)`
}

function dettaglioAssetHtml(d: DettaglioAsset): string {
  const riga = (label: string, a: string, b?: string) =>
    `<tr><td style="${cella} color:#888;">${label}</td><td style="${cella}">${a}</td>${b !== undefined ? `<td style="${cella} font-weight:600;">${b}</td>` : ''}</tr>`
  if (!d.accumulo) {
    return `<table style="width:100%; border-collapse:collapse; margin-top:6px;">
      ${riga('PMC', fmtPrezzo(d.pmc))}
      ${riga('PnL attuale', `<strong>${fmtPct(d.pnlPct)}</strong>`)}
      ${riga('Margine prima del PnL negativo', margineTxt(d.margineGiuPct))}
    </table><div style="font-size:11px;color:#888;margin-top:4px;">Accumulo non previsto per questo asset.</div>`
  }
  return `<table style="width:100%; border-collapse:collapse; margin-top:6px;">
    <tr><td></td><td style="${cella} color:#888;">Prima</td><td style="${cella} color:#888;">Dopo (${fmtEuro(d.importo ?? 0)})</td></tr>
    ${riga('PMC', fmtPrezzo(d.pmc), fmtPrezzo(d.nuovoPmc ?? d.pmc))}
    ${riga('PnL vs PMC', fmtPct(d.pnlPct), fmtPct(d.nuovoPnlPct ?? d.pnlPct))}
    ${riga('Margine prima del PnL negativo', margineTxt(d.margineGiuPct), margineTxt(d.nuovoMargineGiuPct ?? d.margineGiuPct))}
    ${d.pesoPrimaPct != null ? riga('Peso sul patrimonio', `${d.pesoPrimaPct.toFixed(1)}%`, `${(d.pesoDopoPct ?? 0).toFixed(1)}%`) : ''}
  </table>`
}

function dettaglioGlobaleHtml(d: DettaglioAlert): string {
  const blocchi: string[] = []
  if (d.allocazione) {
    const { prima, dopo, target } = d.allocazione
    const r = (label: string, k: 'azioni' | 'obbligazioni' | 'liquidita') =>
      `<tr><td style="${cella} color:#888;">${label}</td><td style="${cella}">${prima[k].toFixed(1)}%</td><td style="${cella} font-weight:600;">${dopo[k].toFixed(1)}%</td><td style="${cella} color:#888;">${target ? target[k].toFixed(0) + '%' : '—'}</td></tr>`
    blocchi.push(`<div style="font-weight:600;margin-top:12px;">Allocazione portafoglio</div>
      <table style="width:100%; border-collapse:collapse;">
        <tr><td></td><td style="${cella} color:#888;">Prima</td><td style="${cella} color:#888;">Dopo</td><td style="${cella} color:#888;">Target</td></tr>
        ${r('Azioni', 'azioni')}${r('Obbligazioni', 'obbligazioni')}${r('Liquidità', 'liquidita')}
      </table>${d.finanziamento ? `<div style="font-size:11px;color:#888;">Fondi prelevati pro-quota dalla riserva: ${fmtEuro(d.finanziamento.daLiquidita)} da liquidità, ${fmtEuro(d.finanziamento.daAssetSvincolati)} da asset svincolati.</div>` : ''}`)
  }
  if (d.holdings) {
    const li = (v: { nome: string; pct: number }[]) => v.map(x => `${x.nome} ${x.pct.toFixed(1)}%`).join(' · ')
    blocchi.push(`<div style="font-weight:600;margin-top:12px;">Top 3 holding (sul valore azionario)</div>
      <div style="font-size:12px;"><span style="color:#888;">Prima:</span> ${li(d.holdings.prima)}</div>
      <div style="font-size:12px;"><span style="color:#888;">Dopo:</span> <strong>${li(d.holdings.dopo)}</strong></div>
      <div style="font-size:11px;color:#aaa;">Copertura dati composizione: ${d.holdings.coperturaPct.toFixed(0)}% del valore azionario.</div>`)
  }
  if (d.budget) {
    blocchi.push(`<div style="font-weight:600;margin-top:12px;">Budget accumulo</div>
      <div style="font-size:12px;">Riserva ${fmtEuro(d.budget.riserva)} · usati <strong>${fmtEuro(d.budget.usato)}</strong> · residui <strong>${fmtEuro(d.budget.residuo)}</strong></div>`)
  }
  return blocchi.length ? `<div style="margin:16px 0; padding:12px 14px; background:#f7f6f0; border-radius:6px; font-size:13px;">${blocchi.join('')}</div>` : ''
}

export async function sendAlertEmail(
  to: string,
  righe: AlertEmailRiga[],
  opts?: { nomeUtente?: string | null; riservaDisponibile?: string | null; dettaglio?: DettaglioAlert | null; appUrl?: string | null }
) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.error('GMAIL_USER o GMAIL_APP_PASSWORD mancanti: email non inviata')
    return
  }
  if (righe.length === 0) return

  const saluto = opts?.nomeUtente ? `Ciao ${opts.nomeUtente},` : 'Ciao,'
  const oggi = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const plurale = righe.length > 1

  const righeHtml = righe.map(r => {
    const triggerHtml = r.trigger.map(t => {
      const segno = t.drawdown >= 0 ? '+' : ''
      return `
        <div style="font-size: 13px; color: #55524a;">
          Soglia <strong>${t.tipoLabel}</strong> superata: variazione <strong>${segno}${t.drawdown.toFixed(1)}%</strong>
          (soglia impostata -${t.sogliaPct}%) — attivazione <strong>#${t.numAttivazione}</strong>
        </div>`
    }).join('')
    let riga = `
      <li style="margin-bottom: 14px; padding: 12px 14px; background: #f7f6f0; border-left: 3px solid #c65d3b; border-radius: 4px;">
        <div style="font-weight: 600; color: #2d2a26; margin-bottom: 4px;">${r.nomeAsset}</div>${triggerHtml}`
    if (r.importoConsigliato != null) {
      riga += `
        <div style="font-size: 13px; color: #4a5d43; margin-top: 6px; padding-top: 6px; border-top: 1px dashed #d8d5c8;">
          💰 Investimento consigliato dalla riserva: <strong>${fmtEuro(r.importoConsigliato)}</strong>
          ${r.nuovoPesoAzionario != null ? `— nuovo peso azionario stimato: <strong>${r.nuovoPesoAzionario.toFixed(1)}%</strong>` : ''}
          ${r.trigger.length > 1 ? '<br><span style="font-size: 11px; color: #888;">Importo unico per l\'asset: non si somma tra le soglie scattate.</span>' : ''}
        </div>`
    }
    if (r.dettaglio) riga += dettaglioAssetHtml(r.dettaglio)
    riga += `</li>`
    return riga
  }).join('')

  const riservaHtml = opts?.riservaDisponibile
    ? `<p style="font-size: 12px; color: #888; margin-top: 4px;">Riserva svincolata disponibile al momento del check: ${opts.riservaDisponibile}</p>`
    : ''

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #2d2a26; max-width: 560px; margin: 0 auto;">
      <h2 style="color: #4a5d43; margin-bottom: 4px;">⚠️ ${righe.length} nuovo${plurale ? 'i' : ''} alert${plurale ? '' : ''} sul portafoglio</h2>
      <p style="font-size: 13px; color: #888; margin-top: 0; text-transform: capitalize;">${oggi}</p>
      <p>${saluto}</p>
      <p style="font-size: 14px;">Oggi ${plurale ? 'sono scattati alert su' : 'è scattato un alert su'} ${righe.length} asset${plurale ? '' : ''}:</p>
      <ul style="list-style: none; padding: 0; margin: 16px 0;">
        ${righeHtml}
      </ul>
      ${opts?.dettaglio ? dettaglioGlobaleHtml(opts.dettaglio) : riservaHtml}
      ${opts?.appUrl ? `<p style="font-size:13px;"><a href="${opts.appUrl}/dashboard/gestione?tab=portafoglio&sezione=alert" style="color:#4a5d43;">Apri il dettaglio in Portafoglio →</a></p>` : ''}
      <p style="font-size: 12px; color: #aaa; margin-top: 24px; border-top: 1px solid #eee; padding-top: 12px;">
        Notifica automatica da app-finanza-personale — la trovi anche nel campanello dell'app.
      </p>
    </div>
  `

  await getTransporter().sendMail({
    from: `"Finanza Personale" <${process.env.GMAIL_USER}>`,
    to,
    subject: `⚠️ ${righe.length} nuovo/i alert portafoglio`,
    html,
  })
}
