/**
 * "Observatory Night" design tokens — the single source of truth for colour, type, radius and
 * motion. Consumed by `tailwind.config.ts` (utility classes), the chart themes (Plotly / Recharts
 * need literal colour strings) and a few inline SVGs.
 *
 * The palette is dark-first: a near-black "void" background with navy surfaces, hairline borders,
 * and a small set of semantic signal colours. Semantic colours are reserved:
 *   - signal.planet (teal)  → class 1, "planet-like"
 *   - signal.fp (amber)     → class 0, "false-positive-like"
 *   - signal.uncertain      → undecided / low-quality verdicts
 *   - nebula (violet)       → AI / model-generated elements
 *   - cosmic (blue)         → primary actions, focus, links
 * They are never used for arbitrary chart series (see `MODEL_PALETTE` in charts/theme.ts).
 *
 * Plain object literals only (no imports) so the file can be loaded by Tailwind's config loader.
 */

export const colors = {
  void: "#05070F",
  space: "#0A0F1E",
  surface: "#0F1629",
  "surface-raised": "#151D35",
  hairline: "#1F2A47",
  "hairline-strong": "#2C3A60",
  "text-primary": "#E6EAF5",
  "text-secondary": "#9AA6C4",
  "text-muted": "#5F6B8A",
  cosmic: "#6E9BFF",
  nebula: "#A08BFF",
  "signal-planet": "#4FD1C5",
  "signal-fp": "#F5A95B",
  "signal-uncertain": "#8B93B8",
  warn: "#F2C94C",
  danger: "#F2727F",
} as const;

export type ColorToken = keyof typeof colors;

/** Font stacks. Fonts are self-hosted through @fontsource (see src/styles/fonts.ts). */
export const fonts = {
  sans: ["Inter Tight", "Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
  mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
  serif: ["Instrument Serif", "Iowan Old Style", "Georgia", "Times New Roman", "serif"],
} as const;

/**
 * Type scale: 12 / 13 / 14 / 16 / 20 / 28 / 40 px, plus the 11 px uppercase mono "eyebrow".
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
