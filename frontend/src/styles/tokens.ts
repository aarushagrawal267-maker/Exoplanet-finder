/**
 * "Observatory Night" design tokens — the single source of truth for colour, type, radius and
 * motion. Consumed by `tailwind.config.ts` (utility classes), the chart themes (Plotly / Recharts
 * need literal colour strings) and a few inline SVGs.
 *
 * The palette is dark-first: a blue-black ink ramp (void → space → surface → raised) with hairline
 * borders, and a small set of semantic signal colours. Semantic colours are reserved:
 *   - signal.planet (teal)  → class 1, "planet-like"
 *   - signal.fp (amber)     → class 0, "false-positive-like"
 *   - signal.uncertain      → undecided / low-quality verdicts
 *   - nebula (violet)       → model output figures only (the model readout and model chart series)
 *   - cosmic (blue)         → primary actions, focus, links
 * They are never used for arbitrary chart series (see `MODEL_PALETTE` in charts/theme.ts).
 *
 * Plain object literals only (no imports) so the file can be loaded by Tailwind's config loader.
 */

export const colors = {
  void: "#06080D",
  space: "#0A0D14",
  surface: "#0E121B",
  "surface-raised": "#141924",
  "surface-hover": "#1A2030",
  hairline: "#1E2431",
  "hairline-strong": "#2B3343",
  "text-primary": "#E6E9F0",
  "text-secondary": "#A1A9BA",
  "text-muted": "#7A8498",
  cosmic: "#6E9BFF",
  "cosmic-hover": "#86ADFF",
  "cosmic-press": "#5D8BF0",
  nebula: "#A08BFF",
  "signal-planet": "#4FD1C5",
  "signal-fp": "#F5A95B",
  "signal-uncertain": "#8B93B8",
  warn: "#F2C94C",
  danger: "#F2727F",
  /* Limb-darkened stellar disc (TransitMark, TransitDiagram, TransitLoader): core → mid → limb. */
  "star-core": "#EEF1FA",
  "star-mid": "#C3CCE8",
  "star-limb": "#7C88B4",
} as const;

export type ColorToken = keyof typeof colors;

/** Font stacks. Fonts are self-hosted through @fontsource (see src/styles/fonts.ts). */
export const fonts = {
  sans: ["Inter Tight", "Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
  mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
  serif: ["Instrument Serif", "Iowan Old Style", "Georgia", "Times New Roman", "serif"],
} as const;

/**
 * Type scale: 11 / 12 / 13 / 14 / 16 / 20 / 28 / 40 px. 11 px is the floor (meta labels).
 * 14 px is the UI body size.
 */
export const fontSize = {
  "2xs": ["11px", { lineHeight: "16px" }],
  xs: ["12px", { lineHeight: "16px" }],
  sm: ["13px", { lineHeight: "20px" }],
  base: ["14px", { lineHeight: "20px" }],
  md: ["16px", { lineHeight: "24px" }],
  lg: ["20px", { lineHeight: "28px" }],
  xl: ["28px", { lineHeight: "34px", letterSpacing: "-0.01em" }],
  "2xl": ["40px", { lineHeight: "44px", letterSpacing: "-0.015em" }],
} as const;

export const radius = {
  sm: "4px",
  DEFAULT: "6px",
  md: "8px",
  lg: "10px",
  card: "12px",
} as const;

/** Motion: short, ease-out, and disabled entirely under prefers-reduced-motion. */
export const motion = {
  fast: "150ms",
  base: "200ms",
  slow: "250ms",
  easeOut: "cubic-bezier(0.22, 1, 0.36, 1)",
} as const;

export const layout = {
  sidebarExpanded: 248,
  sidebarRail: 72,
  topBarHeight: 56,
  mobileBreakpoint: 768,
} as const;
