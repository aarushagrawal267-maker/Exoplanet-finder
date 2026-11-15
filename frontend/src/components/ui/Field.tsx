import { createContext, useContext, useId, type AriaAttributes, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/cn";

interface FieldContextValue {
  id: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/**
 * Controls (Input, NumberInput, Select, Switch, Slider) call this to pick up the id,
 * `aria-describedby` and invalid state of an enclosing <Field>. Explicit props win.
 */
export function useFieldControl(props: { id?: string; "aria-describedby"?: string; "aria-invalid"?: AriaAttributes["aria-invalid"] }) {
  const ctx = useContext(FieldContext);
  return {
    id: props.id ?? ctx?.id,
    "aria-describedby": props["aria-describedby"] ?? ctx?.describedBy,
    "aria-invalid": props["aria-invalid"] ?? (ctx?.invalid ? true : undefined),
    required: ctx?.required ?? false,
  };
}

export interface FieldProps {
  label: ReactNode;
  /** Help text under the control (explains units, ranges, consequences). */
  help?: ReactNode;
  /** Validation message; marks the control invalid. */
  error?: ReactNode;
  required?: boolean;
  /** Right-aligned hint next to the label (e.g. a unit or a provenance chip). */
  aside?: ReactNode;
  id?: string;
  className?: string;
  children: ReactNode;
}

/** Label + control + help / error, wired for assistive technology. */
export function Field({ label, help, error, required = false, aside, id, className, children }: FieldProps) {
  const autoId = useId();
  const controlId = id ?? `field-${autoId}`;
  const helpId = help ? `${controlId}-help` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, helpId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext.Provider value={{ id: controlId, describedBy, invalid: Boolean(error), required }}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={controlId} className="text-sm font-medium text-fg">
            {label}
            {required ? (
              <span className="ml-0.5 text-danger" aria-hidden="true">
                *
              </span>
            ) : null}
          </label>
          {aside ? <span className="text-xs text-fg-secondary">{aside}</span> : null}
        </div>
        {children}
        {error ? (
          <p id={errorId} className="flex items-start gap-1.5 text-xs text-danger">
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : null}
        {help ? (
          <p id={helpId} className="text-xs text-fg-secondary">
            {help}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}
