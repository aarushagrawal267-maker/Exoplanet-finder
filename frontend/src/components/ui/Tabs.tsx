import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface TabItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  /** Optional count rendered in mono after the label. */
  count?: number;
  disabled?: boolean;
  /** Panel content; when any item has content, Tabs renders the active panel. */
  content?: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  "aria-label"?: string;
  className?: string;
  panelClassName?: string;
}

/**
 * WAI-ARIA tabs with roving focus (←/→, Home/End) and automatic activation. The active tab has a
 * 2px cosmic underline.
 */
export function Tabs({ items, value, defaultValue, onChange, className, panelClassName, ...aria }: TabsProps) {
  const baseId = useId();
  const [inner, setInner] = useState(defaultValue ?? items.find((i) => !i.disabled)?.id ?? "");
  const active = value ?? inner;
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const select = (id: string) => {
    if (value === undefined) setInner(id);
    onChange?.(id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = items.filter((i) => !i.disabled);
    const idx = enabled.findIndex((i) => i.id === active);
    let next: TabItem | undefined;
    if (e.key === "ArrowRight") next = enabled[(idx + 1) % enabled.length];
    else if (e.key === "ArrowLeft") next = enabled[(idx - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    if (!next) return;
    e.preventDefault();
    select(next.id);
    refs.current[next.id]?.focus();
  };

  const activeItem = items.find((i) => i.id === active);
  const hasPanels = items.some((i) => i.content !== undefined);

  return (
    <div className={className}>
      {/* The baseline is an inset shadow (not a border + negative-margin tabs): with
          overflow-x:auto a tab hanging 1px into the border makes the tablist vertically
          scrollable, which shows a stray scrollbar on platforms with classic scrollbars. */}
      <div
        role="tablist"
        aria-label={aria["aria-label"]}
        onKeyDown={onKeyDown}
        className="relative flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--c-hairline)]"
      >
        {items.map((item) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              ref={(el) => {
                refs.current[item.id] = el;
              }}
              id={`${baseId}-tab-${item.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={hasPanels ? `${baseId}-panel-${item.id}` : undefined}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => select(item.id)}
              className={cn(
                "relative inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-base font-medium transition-colors duration-fast focus-visible:-outline-offset-2 [&_svg]:size-4",
                selected ? "border-cosmic text-fg" : "border-transparent text-fg-secondary hover:text-fg",
                "disabled:opacity-40",
              )}
            >
              {item.icon}
              {item.label}
              {item.count !== undefined ? (
                <span className={cn("num rounded-sm px-1 text-xs", selected ? "bg-cosmic/15 text-cosmic" : "bg-fg/[0.06] text-fg-secondary")}>
                  {item.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {hasPanels && activeItem ? (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${activeItem.id}`}
          aria-labelledby={`${baseId}-tab-${activeItem.id}`}
          tabIndex={0}
          className={cn("pt-5 focus-visible:outline-offset-4", panelClassName)}
        >
          {activeItem.content}
        </div>
      ) : null}
    </div>
  );
}
