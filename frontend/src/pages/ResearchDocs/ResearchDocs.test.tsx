import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docHref, markdownHeadings, slugify, toDisplayMath } from "@/components/science/Markdown";
import { parseTex, TeX } from "@/components/science/TeX";
import { baseRoutes, mockApi, renderPage } from "@/test/api";
import { docMethodology, docPages } from "@/test/fixtures";
import ResearchDocsPage from "./index";

afterEach(() => vi.unstubAllGlobals());

describe("TeX renderer", () => {
  it("renders the transit-depth formula with a fraction, Greek letters and sub/superscripts", () => {
    const { container } = render(<TeX math={"\\delta \\approx \\left(\\frac{R_p}{R_\\star}\\right)^2"} display />);
    expect(container.textContent).toContain("δ ≈");
    expect(container.querySelector(".tex-frac")).not.toBeNull();
    expect(container.querySelectorAll("sub")).toHaveLength(2);
    expect(container.querySelector("sup")?.textContent).toBe("2");
    expect(container.textContent).toContain("★");
    expect(container.textContent).not.toContain("\\");
  });
  it("handles inline subscripts and unknown commands without leaking backslashes", () => {
    const { container } = render(<TeX math="T_{14} \\unknowncmd" />);
    expect(container.querySelector("sub")?.textContent).toBe("14");
    expect(container.textContent).toContain("unknowncmd");
    expect(parseTex("a^b").length).toBe(2);
  });
});

describe("markdown helpers", () => {
  it("slugifies headings and lists the table of contents", () => {
    expect(slugify("1. The transit method")).toBe("1-the-transit-method");
    expect(markdownHeadings("# T\n\n## 1. The transit method\n```\n## not a heading\n```\n### Sub *part*")).toEqual([
      { level: 2, text: "1. The transit method", id: "1-the-transit-method" },
      { level: 3, text: "Sub part", id: "sub-part" },
    ]);
  });
  it("keeps doc links inside the app", () => {
    expect(docHref("data-sources.md")).toEqual({ internal: true, to: "/docs/data-sources" });
    expect(docHref("./pipeline.md#views")).toEqual({ internal: true, to: "/docs/pipeline#views" });
    expect(docHref("https://exoplanetarchive.ipac.caltech.edu")).toEqual({ internal: false, to: "https://exoplanetarchive.ipac.caltech.edu" });
  });
  it("turns a one-line $$…$$ into display math", () => {
    expect(toDisplayMath("a\n$$x^2,$$\nb")).toBe("a\n$$\nx^2,\n$$\nb");
    expect(toDisplayMath("inline $$x$$ here")).toBe("inline $$x$$ here");
  });
});

describe("Research Docs", () => {
  it("lists pages in reading order", async () => {
    mockApi([...baseRoutes, { path: "/docs/pages", body: docPages }]);
    renderPage(<ResearchDocsPage />, { path: "/docs", route: "/docs" });
    expect(screen.getByRole("heading", { level: 1, name: "Research Docs" })).toBeInTheDocument();
    const links = await screen.findAllByRole("link", { name: /Research methodology|Known limitations/ });
    expect(links[0]).toHaveTextContent("Research methodology"); // methodology before limitations
    expect(links[0]).toHaveAttribute("href", "/docs/methodology");
  });

  it("renders a page with tables, formulas and in-app links", async () => {
    mockApi([...baseRoutes, { path: "/docs/pages", body: docPages }, { path: "/docs/pages/methodology", body: docMethodology }]);
    renderPage(<ResearchDocsPage />, { path: "/docs/:slug", route: "/docs/methodology" });
    expect(await screen.findByRole("heading", { level: 1, name: "Research methodology" })).toBeInTheDocument();
    const article = screen.getByRole("article");
    expect(within(article).getByRole("heading", { level: 2, name: "1. The transit method" })).toHaveAttribute("id", "1-the-transit-method");
    expect(within(article).getByRole("table")).toBeInTheDocument();
    expect(within(article).getByRole("cell", { name: "Missed transits" })).toBeInTheDocument();
    expect(within(article).getAllByRole("math").length).toBe(3);
    expect(within(article).getByRole("link", { name: "Data sources" })).toHaveAttribute("href", "/docs/data-sources");
    // The markdown "# Title" is not repeated under the page header.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("navigation", { name: "Documentation pages" })).toBeInTheDocument();
  });

  it("navigates between pages", async () => {
    mockApi([...baseRoutes, { path: "/docs/pages", body: docPages }, { path: "/docs/pages/methodology", body: docMethodology }]);
    const user = userEvent.setup();
    const { router } = renderPage(<ResearchDocsPage />, { path: "/docs/:slug", route: "/docs/methodology" });
    const next = await screen.findByRole("link", { name: "Next: Known limitations" });
    await user.click(next);
    expect(router.state.location.pathname).toBe("/docs/limitations");
  });

  it("explains a missing page", async () => {
    mockApi([...baseRoutes, { path: "/docs/pages", body: docPages }, { path: "/docs/pages/nope", status: 404, body: { detail: "Documentation page 'nope' not found", code: "doc_not_found", hint: "List pages with GET /api/docs/pages." } }]);
    renderPage(<ResearchDocsPage />, { path: "/docs/:slug", route: "/docs/nope" });
    expect(await screen.findByText("No such page")).toBeInTheDocument();
  });
});
