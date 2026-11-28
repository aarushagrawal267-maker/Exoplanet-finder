/**
 * Markdown renderer for the research documentation (react-markdown + GFM tables/task lists +
 * remark-math, with the small in-house TeX renderer for formulas). Headings get stable ids for the
 * table of contents; links to other docs (`data-sources.md`) stay inside the app (`/docs/…`);
 * external links open in a new tab. No raw HTML is rendered.
 */
import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Link } from "react-router-dom";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { cn } from "@/lib/cn";
import { TeX } from "./TeX";

/** "1. The transit method" → "1-the-transit-method" (stable heading ids). */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as { props: { children?: ReactNode } }).props.children);
  return "";
}

/** Headings (level 2–3) of a markdown document, for a table of contents. */
export function markdownHeadings(md: string): Array<{ level: 2 | 3; text: string; id: string }> {
  const out: Array<{ level: 2 | 3; text: string; id: string }> = [];
  let fence = false;
  for (const line of md.split("\n")) {
    if (/^\s*```/.test(line)) fence = !fence;
    if (fence) continue;
    const m = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      const text = (m[2] as string).replace(/[*_`]/g, "").replace(/\$([^$]+)\$/g, "$1");
      out.push({ level: (m[1] as string).length as 2 | 3, text, id: slugify(text) });
    }
  }
  return out;
}

/** Map a markdown href to an in-app route for sibling docs (`pipeline.md#x` → `/docs/pipeline#x`). */
export function docHref(href: string | undefined): { internal: boolean; to: string } {
  if (!href) return { internal: false, to: "#" };
  if (/^[a-z]+:/i.test(href) || href.startsWith("//")) return { internal: false, to: href };
  if (href.startsWith("#")) return { internal: false, to: href };
  const m = /^(?:\.\/)?(?:docs\/)?([\w-]+)\.md(#.*)?$/.exec(href);
  if (m) return { internal: true, to: `/docs/${m[1]}${m[2] ?? ""}` };
  return { internal: false, to: href };
}

function heading(level: 1 | 2 | 3 | 4) {
  const cls = {
    1: "mt-0 mb-4 text-xl font-medium text-fg",
    2: "mt-10 mb-3 scroll-mt-20 border-t border-hairline pt-6 text-lg font-medium text-fg first:mt-0 first:border-0 first:pt-0",
    3: "mt-7 mb-2 scroll-mt-20 text-md font-semibold text-fg",
    4: "mt-5 mb-2 text-base font-semibold text-fg",
  }[level];
  const Tag = `h${level}` as const;
  return function H({ children }: { children?: ReactNode }) {
    const id = slugify(textOf(children));
    return (
      <Tag id={id} className={cls}>
        {children}
      </Tag>
    );
  };
}

const components: Components = {
  h1: heading(1),
  h2: heading(2),
  h3: heading(3),
  h4: heading(4),
  p: ({ children }) => <p className="my-3 text-base leading-7 text-fg/90">{children}</p>,
  ul: ({ children, className }) => <ul className={cn("my-3 flex list-disc flex-col gap-1.5 pl-6 text-base leading-7 text-fg/90 marker:text-fg-secondary", className?.includes("contains-task-list") && "list-none pl-1")}>{children}</ul>,
  ol: ({ children }) => <ol className="my-3 flex list-decimal flex-col gap-1.5 pl-6 text-base leading-7 text-fg/90 marker:text-fg-secondary marker:num">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-cosmic/60 bg-cosmic/[0.04] py-1 pl-4 text-fg-secondary">{children}</blockquote>,
  hr: () => <hr className="my-8 border-hairline" />,
  a: ({ href, children }) => {
    const { internal, to } = docHref(href);
    if (internal) {
      return (
        <Link to={to} className="text-cosmic underline decoration-cosmic/40 underline-offset-2 hover:decoration-cosmic">
          {children}
        </Link>
      );
    }
    const external = /^https?:/i.test(to);
    return (
      <a href={to} className="text-cosmic underline decoration-cosmic/40 underline-offset-2 hover:decoration-cosmic" {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
        {children}
        {external ? <span className="sr-only"> (opens in a new tab)</span> : null}
      </a>
    );
  },
  table: ({ children }) => (
    <div className="card-surface relative my-5 overflow-x-auto p-0">
      <table className="w-full border-separate border-spacing-0 text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-space">{children}</thead>,
  th: ({ children, style }) => (
    <th scope="col" style={style} className="eyebrow h-10 border-b border-hairline px-4 text-left align-middle font-medium text-fg-secondary">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border-b border-hairline px-4 py-2.5 align-top text-fg [tr:last-child_&]:border-b-0">
      {children}
    </td>
  ),
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const text = String(children ?? "").replace(/\n$/, "");
    if (className?.includes("math-display")) return <TeX math={text} display />;
    if (className?.includes("math-inline")) return <TeX math={text} />;
    if (className?.startsWith("language-") || text.includes("\n")) {
      return (
        <pre className="my-4 overflow-x-auto rounded-md border border-hairline bg-void p-4 text-sm leading-6 text-fg-secondary">
          <code>{text}</code>
        </pre>
      );
    }
    return <code className="rounded-sm border border-hairline bg-space px-1 py-px text-[0.9em] text-fg">{children}</code>;
  },
  input: ({ checked, type }) => (type === "checkbox" ? <input type="checkbox" checked={Boolean(checked)} disabled readOnly className="mr-2 accent-[var(--c-cosmic)]" /> : null),
};

/**
 * A formula written as `$$…$$` on a line of its own is meant as display math, but micromark parses
 * single-line `$$…$$` as inline math; rewrite it as a fenced math block.
 */
export function toDisplayMath(md: string): string {
  return md.replace(/^[ \t]*\$\$([^$\n]+)\$\$[ \t]*$/gm, (_m, tex: string) => `$$\n${tex.trim()}\n$$`);
}

export interface MarkdownProps {
  source: string;
  /** Drop a leading "# Title" (when the page header already shows it). */
  stripTitle?: boolean;
  className?: string;
}

export function Markdown({ source, stripTitle = false, className }: MarkdownProps) {
  const md = toDisplayMath(stripTitle ? source.replace(/^\s*#\s+[^\n]+\n/, "") : source);
  return (
    <div className={cn("max-w-[74ch] min-w-0", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} components={components} skipHtml>
        {md}
      </ReactMarkdown>
    </div>
  );
}
