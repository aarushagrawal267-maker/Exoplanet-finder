/**
 * Tailwind CSS 3.4 configuration — "Observatory Night" design tokens.
 *
 * Colours, type scale, radii and motion all come from `src/styles/tokens.ts` so charts and
 * utilities can never drift apart. The font-size scale is *replaced* (not extended) to enforce
 * the 11/12/13/14/16/20/28/40 px scale (11 px is the floor).
 */
import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import { colors, fonts, fontSize, motion, radius } from "./src/styles/tokens";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    fontSize: fontSize as unknown as NonNullable<Config["theme"]>["fontSize"],
    extend: {
      screens: {
        // Short viewports (e.g. 1366×768 / 1024×768 laptops): the sidebar tightens its rhythm so
        // all twelve destinations stay visible above the status footer.
        short: { raw: "(max-height: 820px)" },
      },
      colors: {
        void: colors.void,
        space: colors.space,
        surface: { DEFAULT: colors.surface, raised: colors["surface-raised"], hover: colors["surface-hover"] },
        hairline: { DEFAULT: colors.hairline, strong: colors["hairline-strong"] },
        fg: {
          DEFAULT: colors["text-primary"],
          primary: colors["text-primary"],
          secondary: colors["text-secondary"],
          muted: colors["text-muted"],
        },
        cosmic: { DEFAULT: colors.cosmic, hover: colors["cosmic-hover"], press: colors["cosmic-press"] },
        nebula: colors.nebula,
        signal: {
          planet: colors["signal-planet"],
          fp: colors["signal-fp"],
          uncertain: colors["signal-uncertain"],
        },
        warn: colors.warn,
        danger: colors.danger,
      },
      fontFamily: {
        sans: [...fonts.sans],
        mono: [...fonts.mono],
        serif: [...fonts.serif],
      },
      borderRadius: { ...radius },
      transitionDuration: {
        DEFAULT: motion.base,
        fast: motion.fast,
        base: motion.base,
        slow: motion.slow,
      },
      transitionTimingFunction: {
        DEFAULT: motion.easeOut,
        out: motion.easeOut,
      },
      spacing: {
        sidebar: "248px",
        rail: "72px",
        topbar: "56px",
      },
      maxWidth: {
        prose: "68ch",
        content: "1320px",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "rise-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-left": { from: { transform: "translateX(-100%)" }, to: { transform: "translateX(0)" } },
        "slide-in-right": { from: { transform: "translateX(100%)" }, to: { transform: "translateX(0)" } },
        shimmer: { from: { backgroundPosition: "-400px 0" }, to: { backgroundPosition: "400px 0" } },
        indeterminate: { "0%": { left: "-33%" }, "100%": { left: "100%" } },
        "transit-orbit": {
          "0%": { transform: "translateX(-18px)" },
          "100%": { transform: "translateX(18px)" },
        },
        "transit-dip": {
          "0%, 30%, 70%, 100%": { transform: "scaleY(0)" },
          "50%": { transform: "scaleY(1)" },
        },
      },
      animation: {
        "fade-in": `fade-in ${motion.base} ${motion.easeOut} both`,
        "rise-in": `rise-in ${motion.slow} ${motion.easeOut} both`,
        "slide-in-left": `slide-in-left ${motion.slow} ${motion.easeOut} both`,
        "slide-in-right": `slide-in-right ${motion.slow} ${motion.easeOut} both`,
        shimmer: "shimmer 1.6s linear infinite",
        indeterminate: "indeterminate 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [
    plugin(({ addBase, addUtilities }) => {
      // Expose every colour token as a CSS custom property (used by SVG art and a few
      // hand-written CSS rules in index.css).
      addBase({
        ":root": Object.fromEntries(Object.entries(colors).map(([k, v]) => [`--c-${k}`, v])),
      });
      addUtilities({
        // Tabular, slashed-zero-free monospaced numerals for every number, ID and coordinate.
        ".num": {
          fontFamily: fonts.mono.join(", "),
          fontVariantNumeric: "tabular-nums",
          fontFeatureSettings: '"tnum" 1, "zero" 0',
        },
        // Section and field labels: sentence case, set in the UI family. (Mono stays for meta
        // values: IDs, counts, coordinates — see `.num`.)
        ".eyebrow": {
          fontFamily: fonts.sans.join(", "),
          fontSize: "12px",
          lineHeight: "16px",
          letterSpacing: "0",
          fontWeight: "500",
        },
        // Instrument Serif, upright, only for page titles and the Overview hero.
        ".font-display": {
          fontFamily: fonts.serif.join(", "),
          fontStyle: "normal",
          fontWeight: "400",
          letterSpacing: "0",
        },
      });
    }),
  ],
};

export default config;
