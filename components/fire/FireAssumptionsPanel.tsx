// components/fire/FireAssumptionsPanel.tsx
"use client";

import { useState } from "react";
import type { FireParametri } from "@/lib/fireCalculations";
import DebitiEditor from "./DebitiEditor";

interface FireAssumptionsPanelProps {
  parametri: FireParametri;
  onChange: (parametri: FireParametri) => void;
}

// Ogni colonna ha un proprio accento cromatico (variazioni sage/terra coerenti
// con la palette dell'app) così le quattro sezioni si distinguono senza bordi
// pesanti o card-in-card.
const ACCENTI = {
  spese: "border-t-stone-400",
  investimenti: "border-t-emerald-600",
  fondo: "border-t-teal-600",
  generali: "border-t-amber-600",
} as const;

function Campo({
  label,
  value,
  onChange,
  suffix,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] leading-tight text-stone-500">{label}</span>
      <div className="mt-1 flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 focus-within:border-emerald-500">
        <input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full min-w-0 border-0 p-0 font-mono text-sm text-stone-800 outline-none"
        />
        {suffix && <span className="shrink-0 text-[10px] text-stone-400">{suffix}</span>}
      </div>
    </label>
  );
}

function Colonna({
  titolo,
  accento,
  children,
}: {
  titolo: string;
  accento: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`border-t-2 ${accento} pt-3`}>
      <h4 className="mb-2.5 text-sm font-medium text-stone-700">{titolo}</h4>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

export default function FireAssumptionsPanel({
  parametri,
  onChange,
}: FireAssumptionsPanelProps) {
  const [aperto, setAperto] = useState(false);

  function set<K extends keyof FireParametri>(campo: K, valore: FireParametri[K]) {
    onChange({ ...parametri, [campo]: valore });
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50/60">
      <button
        type="button"
        onClick={() => setAperto((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="font-serif text-base text-stone-800">
          Parametri e assunzioni
        </span>
        <span className="text-stone-400">{aperto ? "−" : "+"}</span>
      </button>

      {aperto && (
        <div className="space-y-6 border-t border-stone-200 px-4 py-4">
          <div className="grid grid-cols-2 gap-x-5 gap-y-6 lg:grid-cols-4">
            <Colonna titolo="Spese" accento={ACCENTI.spese}>
              <Campo
                label="Spese annue base"
                value={parametri.speseAnnueBase}
                onChange={(v) => set("speseAnnueBase", v)}
                suffix="€/anno"
              />
              <Campo
                label="Crescita spese"
                value={parametri.crescitaSpesePct}
                onChange={(v) => set("crescitaSpesePct", v)}
                suffix="%/anno"
                step={0.1}
              />
            </Colonna>

            <Colonna titolo="Investimenti" accento={ACCENTI.investimenti}>
              <Campo
                label="Investimento annuo"
                value={parametri.investimentoAnnuoBase}
                onChange={(v) => set("investimentoAnnuoBase", v)}
                suffix="€/anno"
              />
              <Campo
                label="Crescita investimento"
                value={parametri.crescitaInvestimentoPct}
                onChange={(v) => set("crescitaInvestimentoPct", v)}
                suffix="%/anno"
                step={0.1}
              />
              <Campo
                label="Rendimento atteso"
                value={parametri.rendimentoInvestimentiPct}
                onChange={(v) => set("rendimentoInvestimentiPct", v)}
                suffix="%/anno"
                step={0.1}
              />
              <Campo
                label="Tassazione interessi"
                value={parametri.tassazioneInteressiPct}
                onChange={(v) => set("tassazioneInteressiPct", v)}
                suffix="%"
                step={0.5}
              />
            </Colonna>

            <Colonna titolo="Fondo pensione" accento={ACCENTI.fondo}>
              <Campo
                label="Rendimento atteso"
                value={parametri.rendimentoFondoPensionePct}
                onChange={(v) => set("rendimentoFondoPensionePct", v)}
                suffix="%/anno"
                step={0.1}
              />
              <Campo
                label="Tassazione fondo"
                value={parametri.tassazioneFondoPensionePct}
                onChange={(v) => set("tassazioneFondoPensionePct", v)}
                suffix="%"
                step={0.5}
              />
              <label className="flex items-center gap-1.5 pt-1 text-[11px] text-stone-500">
                <input
                  type="checkbox"
                  checked={parametri.includiFondoPensioneInFireNumber}
                  onChange={(e) =>
                    set("includiFondoPensioneInFireNumber", e.target.checked)
                  }
                />
                Includi nel FIRE number
              </label>
            </Colonna>

            <Colonna titolo="Generali" accento={ACCENTI.generali}>
              <Campo
                label="Inflazione"
                value={parametri.inflazionePct}
                onChange={(v) => set("inflazionePct", v)}
                suffix="%/anno"
                step={0.1}
              />
              <Campo
                label="Safe Withdrawal Rate"
                value={parametri.swrPct}
                onChange={(v) => set("swrPct", v)}
                suffix="%"
                step={0.1}
              />
              <Campo
                label="Orizzonte proiezione"
                value={parametri.orizzonteAnni}
                onChange={(v) => set("orizzonteAnni", v)}
                suffix="anni"
              />
            </Colonna>
          </div>

          <div className="border-t border-stone-200 pt-4">
            <h4 className="mb-2.5 text-sm font-medium text-stone-700">Debiti</h4>
            <DebitiEditor
              debiti={parametri.debiti}
              onChange={(debiti) => set("debiti", debiti)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
