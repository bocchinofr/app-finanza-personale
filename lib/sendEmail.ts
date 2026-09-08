import nodemailer from 'nodemailer'

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

export interface AlertEmailRiga {
  nomeAsset: string
  tipoLabel: string
  sogliaPct: number
  drawdown: number
  numAttivazione: number
  importoConsigliato?: number
  nuovoPesoAzionario?: number
}

function fmtEuro(n: number) {
  return `€${Math.round(n).toLocaleString('it-IT')}`
}

export async function sendAlertEmail(
  to: string,
  righe: AlertEmailRiga[],
  opts?: { nomeUtente?: string | null; riservaDisponibile?: string | null }
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
    const segnoDrawdown = r.drawdown >= 0 ? '+' : ''
    let riga = `
      <li style="margin-bottom: 14px; padding: 12px 14px; background: #f7f6f0; border-left: 3px solid #c65d3b; border-radius: 4px;">
        <div style="font-weight: 600; color: #2d2a26; margin-bottom: 4px;">${r.nomeAsset}</div>
        <div style="font-size: 13px; color: #55524a;">
          Soglia <strong>${r.tipoLabel}</strong> superata: variazione <strong>${segnoDrawdown}${r.drawdown.toFixed(1)}%</strong>
          (soglia impostata -${r.sogliaPct}%) — attivazione <strong>#${r.numAttivazione}</strong>
        </div>`
    if (r.importoConsigliato != null) {
      riga += `
        <div style="font-size: 13px; color: #4a5d43; margin-top: 6px; padding-top: 6px; border-top: 1px dashed #d8d5c8;">
          💰 Investimento consigliato dalla riserva: <strong>${fmtEuro(r.importoConsigliato)}</strong>
          ${r.nuovoPesoAzionario != null ? `— nuovo peso azionario stimato: <strong>${r.nuovoPesoAzionario.toFixed(1)}%</strong>` : ''}
        </div>`
    }
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
      <p style="font-size: 14px;">Oggi ${plurale ? 'sono scattate' : 'è scattata'} ${righe.length} nuov${plurale ? 'e' : 'a'} soglia${plurale ? 'e' : ''} di alert:</p>
      <ul style="list-style: none; padding: 0; margin: 16px 0;">
        ${righeHtml}
      </ul>
      ${riservaHtml}
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
