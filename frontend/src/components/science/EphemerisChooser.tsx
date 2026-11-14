/**
 * Where the transit ephemeris (period P, mid-transit epoch T₀, duration T₁₄) comes from:
 *  - catalogue: the selected NASA signal's published values;
 *  - BLS: measured by a Box Least Squares search of the light curve;
 *  - manual: typed in by the user (same time system as the light curve).
 */
import type { ReactNode } from "react";
import { Field } from "@/components/ui/Field";
import { NumberInput } from "@/components/ui/NumberInput";
import { ProvenanceChip } from "@/components/ui/ProvenanceChip";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

export type EphemerisMode = "catalog" | "bls" | "manual";

export interface ManualEphemeris {
  period: number | null;
  epoch: number | null;
  durationHours: number | null;
}

/** Field-level problems with a manual ephemeris (empty object when valid). */
export function validateEphemeris(e: ManualEphemeris): Partial<Record<keyof ManualEphemeris, string>> {
  const out: Partial<Record<keyof ManualEphemeris, string>> = {};
  if (e.period === null || !(e.period > 0)) out.period = "Enter a period greater than 0 days.";
  if (e.epoch === null || !Number.isFinite(e.epoch)) out.epoch = "Enter the time of one transit centre.";
  if (e.durationHours === null || !(e.durationHours > 0)) out.durationHours = "Enter a duration greater than 0 hours.";
  else if (e.period && e.durationHours >= e.period * 24) out.durationHours = "The duration must be shorter than the period.";
  return out;
}

export function isEphemerisComplete(e: ManualEphemeris): e is { period: number; epoch: number; durationHours: number } {
  return Object.keys(validateEphemeris(e)).length === 0;
}

export interface EphemerisChooserProps {
  mode: EphemerisMode;
  onModeChange: (mode: EphemerisMode) => void;
  manual: ManualEphemeris;
  onManualChange: (e: ManualEphemeris) => void;
  /** A catalogue signal is selected (otherwise "Catalogue" is disabled). */
  catalogAvailable: boolean;
  /** Hide BLS (e.g. not offered by the caller). */
  allowBls?: boolean;
  timeSystem?: string;
  /** Extra explanation under the active mode. */
  note?: ReactNode;
  /** Show validation messages (after the user tried to run). */
  showErrors?: boolean;
}

export function EphemerisChooser({
  mode,
  onModeChange,
  manual,
  onManualChange,
  catalogAvailable,
  allowBls = true,
  timeSystem = "BKJD",
  note,
  showErrors = false,
}: EphemerisChooserProps) {
  const errors = showErrors ? validateEphemeris(manual) : {};
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl<EphemerisMode>
          aria-label="Ephemeris source"
          value={mode}
          onChange={onModeChange}
          options={[
            { value: "catalog", label: "Catalogue", disabled: !catalogAvailable },
            ...(allowBls ? [{ value: "bls" as const, label: "BLS search" }] : []),
            { value: "manual", label: "Manual" },
          ]}
        />
        <ProvenanceChip kind={mode === "catalog" ? "catalogue" : mode === "bls" ? "measured" : "manual"} />
      </div>
      {mode === "catalog" ? (
        <p className="text-sm text-fg-secondary">
          {catalogAvailable ? "Uses the selected signal's published period, epoch and duration." : "Select a catalogue signal to use its published ephemeris."}
        </p>
      ) : null}
      {mode === "bls" ? <p className="text-sm text-fg-secondary">The period, epoch and duration are measured by a Box Least Squares search of the flattened light curve.</p> : null}
      {mode === "manual" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Period" required error={errors.period}>
            <NumberInput value={manual.period} onChange={(v) => onManualChange({ ...manual, period: v })} min={0} step={0.0001} precision={6} unit="d" allowEmpty hideSteppers />
          </Field>
          <Field label="Epoch T₀" required error={errors.epoch} help={`Mid-transit time (${timeSystem})`}>
            <NumberInput value={manual.epoch} onChange={(v) => onManualChange({ ...manual, epoch: v })} step={0.0001} precision={5} unit={timeSystem} allowEmpty hideSteppers />
          </Field>
          <Field label="Duration T₁₄" required error={errors.durationHours}>
            <NumberInput
              value={manual.durationHours}
              onChange={(v) => onManualChange({ ...manual, durationHours: v })}
              min={0}
              step={0.01}
              precision={3}
              unit="h"
              allowEmpty
              hideSteppers
            />
          </Field>
        </div>
      ) : null}
      {note}
    </div>
  );
}
