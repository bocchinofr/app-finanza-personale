// components/fire/FireTabellaPrevisionale.tsx
"use client";

import type { AnnoProiezione, EsitoRicalcolo } from "@/lib/fireCalculations";

interface FireTabellaPrevisionaleProps {
  proiezione: AnnoProiezione[]; // previsione salvata (di riferimento)
  annoCorrente: number;
  etichettaCalcolo: string; // es. "calcolata il 28/10/2026"
  onRicalcola: () => void;
  ricalcolando: boolean;
  esito: EsitoRicalcolo | null;
  onChiudiEsito: () => void;
}

function euro(v: number): string {
  return v.toLocaleString("it-IT", { maximumFractionDigits: 0 });
}

function euroCompatto(v: number): string {
  const abs = Math.abs(v);
  const segno = v < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${segno}${(abs / 1_000_000).toFixed(2).replace(".", ",")} M`;
  return `${segno}${euro(abs)}`;
}

function IconaRicalcola({ girando }: { girando: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={girando ? "animate-spin" : ""}
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

const STILE_ESITO = {
  migliorata: {
    box: "border-emerald-200 bg-emerald-50 text-emerald-800",
    titolo: "Proiezione migliorata",
    freccia: "▲",
  },
  peggiorata: {
    box: "border-amber-200 bg-amber-50 text-amber-800",
    titolo: "Proiezione peggiorata",
    freccia: "▼",
  },
  invariata: {
    box: "border-stone-200 bg-stone-50 text-stone-700",
    titolo: "Proiezione invariata",
    freccia: "●",
  },
} as const;

function NotaEsito({ esito, onChiudi }: { esito: EsitoRicalcolo; onChiudi: () => void }) {
  const stile = STILE_ESITO[esito.esito];

  let testoFire: string | null = null;
  if (esito.annoFireNuovo !== null && esito.annoFirePrecedente !== null) {
    const diff = esito.annoFireNuovo - esito.annoFirePrecedente;
    if (diff < 0) testoFire = `FIRE anticipato di ${Math.abs(diff)} ${Math.abs(diff) === 1 ? "anno" : "anni"} (ora ${esito.annoFireNuovo})`;
    else if (diff > 0) testoFire = `FIRE posticipato di ${diff} ${diff === 1 ? "anno" : "anni"} (ora ${esito.annoFireNuovo})`;
    else testoFire = `Anno FIRE invariato (${esito.annoFireNuovo})`;
  } else if (esito.annoFireNuovo !== null) {
    testoFire = `Ora il FIRE risulta raggiungibile nel ${esito.annoFireNuovo}`;
  } else if (esito.annoFirePrecedente !== null) {
    testoFire = "Ora il FIRE non risulta più raggiungibile nell\u2019orizzonte";
  }

  return (
    <div className={`mt-4 rounded-lg border px-4 py-3 ${stile.box}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">
          <span className="mr-1.5 text-xs">{stile.freccia}</span>
          {stile.titolo} rispetto alla precedente
        </p>
        <button
          type="button"
          onClick={onChiudi}
          className="text-xs opacity-60 hover:opacity-100"
          aria-label="Chiudi nota"
        >
          ✕
        </button>
      </div>
      <ul className="mt-1.5 space-y-0.5">
        {esito.righe.map((r) => (
          <li key={r.anno} className="font-mono text-xs">
            Patrimonio a fine {r.anno}: € {euro(r.patrimonioNuovo)} vs € {euro(r.patrimonioPrecedente)} previsti
            {" "}
            ({r.deltaPct >= 0 ? "+" : ""}
            {r.deltaPct.toFixed(1)}%)
          </li>
        ))}
      </ul>
      {testoFire && <p className="mt-1 text-xs">{testoFire}</p>}
    </div>
  );
}

export default function FireTabellaPrevisionale({
  proiezione,
  annoCorrente,
  etichettaCalcolo,
  onRicalcola,
  ricalcolando,
  esito,
  onChiudiEsito,
}: FireTabellaPrevisionaleProps) {
  const annoFire = proiezione.find((a) => a.fireRaggiunto)?.anno ?? null;
  const mancanoEntrate = proiezione.length > 0 && proiezione[0].entrateAnnue === undefined;

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-lg text-stone-800">Previsione anno per anno</h3>
          <p className="text-[11px] text-stone-400">
            Previsione di riferimento, {etichettaCalcolo}. Resta ferma finché non la ricalcoli.
          </p>
        </div>
        <button
          type="button"
          onClick={onRicalcola}
          disabled={ricalcolando}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:opacity-60"
        >
          <IconaRicalcola girando={ricalcolando} />
          {ricalcolando ? "Ricalcolo…" : "Ricalcola"}
        </button>
      </div>

      {esito && <NotaEsito esito={esito} onChiudi={onChiudiEsito} />}

      {mancanoEntrate && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Questa previsione è stata salvata prima dell&apos;introduzione di entrate e risparmio: premi Ricalcola per completarla.
        </p>
      )}

      <div className="mt-4 max-h-[30rem] overflow-auto rounded-lg border border-stone-100">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-stone-50 text-[11px] uppercase tracking-wide text-stone-500">
            <tr>
              <th className="sticky left-0 z-20 bg-stone-50 px-3 py-2 text-left font-medium">Anno</th>
              <th className="px-3 py-2 text-right font-medium">Età</th>
              <th className="px-3 py-2 text-left font-medium">Fase</th>
              <th className="px-3 py-2 text-right font-medium">Entrate</th>
              <th className="px-3 py-2 text-right font-medium">Uscite</th>
              <th className="px-3 py-2 text-right font-medium">Risparmio</th>
              <th className="px-3 py-2 text-right font-medium">Patrimonio</th>
            </tr>
          </thead>
          <tbody className="font-mono text-[13px] tabular-nums text-stone-700">
            {proiezione.map((a) => {
              const isFire = annoFire === a.anno;
              const isCorrente = a.anno === annoCorrente;
              const sfondo = isFire ? "bg-emerald-50" : isCorrente ? "bg-stone-50" : "bg-white";
              const haEntrate = a.entrateAnnue !== undefined;
              return (
                <tr key={a.anno} className={`border-t border-stone-100 ${sfondo}`}>
                  <td className={`sticky left-0 px-3 py-1.5 text-left ${sfondo} ${isCorrente ? "border-l-2 border-l-emerald-600 font-semibold" : ""}`}>
                    {a.anno}
                    {isFire && (
                      <span className="ml-2 rounded bg-emerald-600 px-1.5 py-0.5 font-sans text-[9px] font-semibold tracking-wide text-white">
                        FIRE
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right text-stone-500">{a.eta}</td>
                  <td className="px-3 py-1.5 text-left">
                    <span
                      className={`rounded-full px-2 py-0.5 font-sans text-[10px] ${
                        a.fase === "accumulo" ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {a.fase === "accumulo" ? "Accumulo" : "Decumulo"}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right">{haEntrate ? euroCompatto(a.entrateAnnue) : "—"}</td>
                  <td className="px-3 py-1.5 text-right">{euroCompatto(a.speseAnnue)}</td>
                  <td
                    className={`px-3 py-1.5 text-right ${
                      !haEntrate ? "" : a.risparmioAnnuo >= 0 ? "text-emerald-700" : "text-amber-700"
                    }`}
                  >
                    {haEntrate ? euroCompatto(a.risparmioAnnuo) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-medium text-stone-900">
                    {euroCompatto(a.patrimonioTotale)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] leading-snug text-stone-400">
        Valori a fine anno. Risparmio = entrate − uscite; in decumulo le entrate da lavoro sono zero e il valore negativo è il prelievo dal capitale. Patrimonio = investito + fondo pensione.
      </p>
    </div>
  );
}
