/**
 * Self-hosted fonts (no third-party font CDN): Inter Tight for UI text, JetBrains Mono for every
 * number / identifier / coordinate, and Instrument Serif italic for page titles and editorial
 * headings. Each CSS file declares `unicode-range` subsets, so browsers only download the glyph
 * ranges they actually need.
 */
import "@fontsource/inter-tight/400.css";
import "@fontsource/inter-tight/500.css";
import "@fontsource/inter-tight/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
