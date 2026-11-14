/**
 * TeX — a deliberately small renderer for the "math-ish" LaTeX used in the research docs
 * ($P$, $T_{14}$, $$\delta \approx \left(\frac{R_p}{R_\star}\right)^2$$). It handles Greek letters
 * and common symbols, sub/superscripts, \frac, \sqrt, \left/\right delimiters, \text and spacing,
 * and renders them as semantic HTML (sub, sup, a stacked fraction) in the serif italic face —
 * no KaTeX / MathJax bundle. Unknown commands fall back to their name, never to raw backslashes.
 */
import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/cn";

const SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", iota: "ι",
  kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ",
  varphi: "φ", chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
  Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  star: "★", odot: "⊙", oplus: "⊕", approx: "≈", sim: "∼", simeq: "≃", propto: "∝", times: "×", cdot: "·", pm: "±", mp: "∓",
  le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", ll: "≪", gg: "≫", infty: "∞", to: "→", rightarrow: "→",
  leftarrow: "←", Rightarrow: "⇒", partial: "∂", nabla: "∇", sum: "Σ", prod: "Π", int: "∫", degree: "°", circ: "∘",
  ldots: "…", cdots: "⋯", prime: "′", lvert: "|", rvert: "|", vert: "|", langle: "⟨", rangle: "⟩",
};
const SPACES: Record<string, string> = { ",": " ", ";": " ", ":": " ", "!": "", " ": " ", quad: " ", qquad: "  " };
const TEXT_COMMANDS = new Set(["text", "mathrm", "mathit", "mathbf", "mathsf", "operatorname", "textrm", "textit"]);

/** Parse a TeX string into React nodes (exported for tests). */
export function parseTex(src: string): ReactNode[] {
  let i = 0;
  let key = 0;
  const k = () => `t${key++}`;

  const readCommand = (): string => {
    // At a backslash: returns the command name ("frac") or the single symbol ("," / "{").
    i += 1;
    const m = /^[A-Za-z]+/.exec(src.slice(i));
    if (m) {
      i += m[0].length;
      return m[0];
    }
    const ch = src[i] ?? "";
    i += 1;
    return ch;
  };

  const skipSpaces = () => {
    while (src[i] === " ") i += 1;
  };

  const delimiter = (): string => {
    skipSpaces();
    if (src[i] === "\\") {
      const c = readCommand();
      return c === "{" || c === "}" ? c : (SYMBOLS[c] ?? c);
    }
    const ch = src[i] ?? "";
    i += 1;
    return ch === "." ? "" : ch;
  };

  const command = (name: string): ReactNode => {
    if (name === "frac" || name === "dfrac" || name === "tfrac") {
      const num = atom();
      const den = atom();
      return (
        <span key={k()} className="tex-frac mx-[0.1em] inline-flex flex-col items-center text-center align-middle text-[0.8em] leading-[1.15]">
          <span className="border-b border-current px-[0.15em] pb-[0.05em]">{num}</span>
          <span className="px-[0.15em] pt-[0.05em]">{den}</span>
        </span>
      );
    }
    if (name === "sqrt") {
      const arg = atom();
      return (
        <span key={k()}>
          √<span className="border-t border-current">{arg}</span>
        </span>
      );
    }
    if (name === "left" || name === "right" || name === "bigl" || name === "bigr" || name === "big" || name === "Big") {
      const d = delimiter();
      return d ? (
        <span key={k()} className="text-[1.2em]">
          {d}
        </span>
      ) : null;
    }
    if (TEXT_COMMANDS.has(name)) {
      const arg = atom();
      return (
        <span key={k()} className="not-italic">
          {arg}
        </span>
      );
    }
    if (name in SPACES) return SPACES[name];
    if (name === "{" || name === "}" || name === "%" || name === "$" || name === "_" || name === "&") return name;
    return SYMBOLS[name] ?? name;
  };

  // One token: a {group}, a \command, or a single character.
  function atom(): ReactNode[] {
    skipSpaces();
    if (src[i] === "{") {
      i += 1;
      return group();
    }
    if (src[i] === "\\") return [command(readCommand())];
    const ch = src[i] ?? "";
    i += 1;
    return [ch];
  }

  // Parse until the matching "}" (or the end of input).
  function group(): ReactNode[] {
    const out: ReactNode[] = [];
    let text = "";
    const flush = () => {
      if (text) out.push(text);
      text = "";
    };
    while (i < src.length) {
      const ch = src[i] as string;
      if (ch === "}") {
        i += 1;
        break;
      }
      if (ch === "{") {
        i += 1;
        flush();
        out.push(<Fragment key={k()}>{group()}</Fragment>);
        continue;
      }
      if (ch === "^" || ch === "_") {
        i += 1;
        flush();
        const arg = atom();
        out.push(ch === "^" ? <sup key={k()}>{arg}</sup> : <sub key={k()}>{arg}</sub>);
        continue;
      }
      if (ch === "\\") {
        flush();
        out.push(command(readCommand()));
        continue;
      }
      text += ch;
      i += 1;
    }
    flush();
    return out;
  }

  return group();
}

export function TeX({ math, display = false, className }: { math: string; display?: boolean; className?: string }) {
  const nodes = parseTex(math.trim());
  if (display) {
    return (
      <div className={cn("my-5 overflow-x-auto text-center font-serif text-xl italic text-fg", className)} role="math" aria-label={math}>
        {nodes}
      </div>
    );
  }
  return (
    <span className={cn("font-serif text-[1.08em] italic text-fg", className)} role="math" aria-label={math}>
      {nodes}
    </span>
  );
}
