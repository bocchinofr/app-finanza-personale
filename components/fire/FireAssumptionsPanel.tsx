// components/fire/FireAssumptionsPanel.tsx
"use client";

import { useState } from "react";
import type { FireParametri } from "@/lib/fireCalculations";
import DebitiEditor from "./DebitiEditor";

interface FireAssumptionsPanelProps {
  parametri: FireParametri;
  onChange: (parametri: FireParametri) => void;
}

function CampoNumero({
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
    <label className="flex flex-col gap-1 text-sm text-stone-600">
      <span>{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full rounded-md border border-stone-200 px-2 py-1.5 font-mono text-sm"
        />
        {suffix && <span className="text-xs text-stone-400">{suffix}</span>}
      </div>
    </label>
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
          {/* Spese */}
          <section className="space-y-3">
            <h4 className="text-sm font-medium text-stone-700">Spese</h4>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <CampoNumero
                label="Spese annue base"
                value={parametri.speseAnnueBase}
                onChange={(v) => set("speseAnnueBase", v)}
                suffix="€/anno"
              />
              <CampoNumero
                label="Crescita spese"
                value={parametri.crescitaSpesePct}
                onChange={(v) => set("crescitaSpesePct", v)}
                suffix="%/anno"
                step={0.1}
              />
            </div>
          </section>

          {/* Investimenti */}
          <section className="space-y-3">
            <h4 className="text-sm font-medium text-stone-700">Investimenti</h4>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <CampoNumero
                label="Investimento annuo"
                value={parametri.investimentoAnnuoBase}
                onChange={(v) => set("investimentoAnnuoBase", v)}
                suffix="€/anno"
              />
              <CampoNumero
                label="Crescita investimento"
                value={parametri.crescitaInvestimentoPct}
                onChange={(v) => set("crescitaInvestimentoPct", v)}
                suffix="%/anno"
                step={0.1}
              />
              <CampoNumero
                label="Rendimento atteso"
                value={parametri.rendimentoInvestimentiPct}
                onChange={(v) => set("rendimentoInvestimentiPct", v)}
                suffix="%/anno"
                step={0.1}
              />
              <CampoNumero
                label="Tassazione interessi"
                value={parametri.tassazioneInteressiPct}
                onChange={(v) => set("tassazioneInteressiPct", v)}
                suffix="%"
                step={0.5}
              />
            </div>
          </section>

          {/* Fondo pensione */}
          <section className="space-y-3">
            <h4 className="text-sm font-medium text-stone-700">Fondo pensione</h4>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <CampoNumero
                label="Rendimento atteso"
                value={parametri.rendimentoFondoPensionePct}
                onChange={(v) => set("rendimentoFondoPensionePct", v)}
                suffix="%/anno"
                step={0.1}
              />
              <CampoNumero
                label="Tassazione fondo"
                value={parametri.tassazioneFondoPensionePct}
                onChange={(v) => set("tassazioneFondoPensionePct", v)}
                suffix="%"
                step={0.5}
              />
              <label className="flex items-center gap-2 self-end pb-1.5 text-sm text-stone-600">
                <input
                  type="checkbox"
                  checked={parametri.includiFondoPensioneInFireNumber}
                  onChange={(e) =>
                    set("includiFondoPensioneInFireNumber", e.target.checked)
                  }
                />
                Includi nel FIRE number
              </label>
            </div>
          </section>

          {/* Macro */}
          <section className="space-y-3">
            <h4 className="text-sm font-medium text-stone-700">Parametri generali</h4>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <CampoNumero
                label="Inflazione"
                value={parametri.inflazionePct}
                onChange={(v) => set("inflazionePct", v)}
                suffix="%/anno"
                step={0.1}
              />
              <CampoNumero
                label="Safe Withdrawal Rate"
                value={parametri.swrPct}
                onChange={(v) => set("swrPct", v)}
                suffix="%"
                step={0.1}
              />
              <CampoNumero
                label="Orizzonte proiezione"
                value={parametri.orizzonteAnni}
                onChange={(v) => set("orizzonteAnni", v)}
                suffix="anni"
              />
            </div>
          </section>

          {/* Debiti */}
          <section className="space-y-3">
            <h4 className="text-sm font-medium text-stone-700">Debiti</h4>
            <DebitiEditor
              debiti={parametri.debiti}
              onChange={(debiti) => set("debiti", debiti)}
            />
          </section>
        </div>
      )}
    </div>
  );
}
