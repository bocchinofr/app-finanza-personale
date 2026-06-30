# Patrimonio Netto — Setup Guide

## Stack
- **Next.js 15** (App Router) → frontend + API routes
- **Supabase** (Postgres + Auth) → database gratuito
- **Vercel** → hosting gratuito
- **Google Sheets** → sorgente dati via API pubblica

---

## 1. Installa dipendenze (già fatto se hai seguito i passaggi)

```bash
cd patrimonio-app
npm install
```

---

## 2. Crea progetto Supabase

1. Vai su [supabase.com](https://supabase.com) → **New project**
2. Nome: `patrimonio-netto` · Regione: **West EU (Ireland)**
3. **Database → SQL Editor → New query** → incolla `supabase-schema.sql` → Run
4. **Project Settings → API** → copia:
   - `Project URL` → sarà `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → sarà `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## 3. Configura variabili d'ambiente locali

```bash
cp .env.example .env.local
# Apri .env.local e incolla i valori Supabase
```

---

## 4. Testa in locale

```bash
npm run dev
# Apri http://localhost:3000
```

Registra un account, vai su **Importa dati** → clicca **Sincronizza da Google Sheets**.

---

## 5. Pubblica su GitHub

```bash
git init
git add .
git commit -m "primo commit"
# Crea repo su github.com, poi:
git remote add origin https://github.com/TUO_USERNAME/patrimonio-netto.git
git branch -M main
git push -u origin main
```

---

## 6. Deploy su Vercel

1. [vercel.com](https://vercel.com) → **Add New Project** → importa il repo GitHub
2. **Environment Variables** → aggiungi:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. **Deploy** → ogni `git push` farà deploy automatico

---

## 7. Configura Supabase per produzione

In Supabase → **Authentication → URL Configuration**:
- Site URL: `https://tuo-progetto.vercel.app`
- Redirect URLs: `https://tuo-progetto.vercel.app/**`

---

## Come funziona il caricamento dati

Il foglio Google è pubblico in lettura. L'app ha un'API route (`/api/sync-sheets`)
che recupera il CSV server-side (evita problemi CORS) e lo parsifica.
I dati vengono salvati su Supabase con Row Level Security: ogni utente vede solo i propri.

Per aggiornare i dati: **Dashboard → Importa dati → Sincronizza da Google Sheets**.

---

## Struttura progetto

```
patrimonio-netto/
├── app/
│   ├── api/sync-sheets/   # Proxy API per Google Sheets
│   ├── auth/login/        # Login + registrazione
│   ├── dashboard/
│   │   ├── page.tsx       # Movimenti + Cash Flow heatmap
│   │   └── upload/        # Sync Google Sheets + upload xlsx
│   ├── layout.tsx
│   └── globals.css
├── components/charts/
│   └── HeatmapCell.tsx
├── lib/
│   ├── supabase.ts
│   ├── parseGoogleSheet.ts  # Parser CSV da Google Sheets
│   └── parseXlsx.ts         # Parser file xlsx locale
├── types/index.ts
├── supabase-schema.sql
└── .env.example
```
