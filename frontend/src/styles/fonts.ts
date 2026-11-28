/**
 * Self-hosted fonts (no third-party font CDN): Inter Tight for UI text, JetBrains Mono for every
 * number / identifier / coordinate, and Instrument Serif (upright) for page titles and the
 * Overview hero. The serif italic cut is only used for inline maths (TeX.tsx). Each CSS file
 * declares `unicode-range` subsets, so browsers only download the glyph ranges they need.
 */
import "@fontsource/inter-tight/400.css";
import "@fontsource/inter-tight/500.css";
import "@fontsource/inter-tight/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
