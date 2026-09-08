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

export async function sendAlertEmail(to: string, righe: string[]) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.error('GMAIL_USER o GMAIL_APP_PASSWORD mancanti: email non inviata')
    return
  }
  if (righe.length === 0) return

  const html = `
    <div style="font-family: sans-serif; color: #2d2a26;">
      <h2 style="color: #4a5d43;">Nuovi alert sul portafoglio</h2>
      <ul>
        ${righe.map(r => `<li style="margin-bottom: 6px;">${r}</li>`).join('')}
      </ul>
      <p style="font-size: 12px; color: #888; margin-top: 20px;">
        Notifica automatica da app-finanza-personale.
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
