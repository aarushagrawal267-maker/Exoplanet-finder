import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { agreement, ProvenanceTable } from "./ProvenanceTable";
import { verdictClass } from "./verdict";
import { RESEARCH_LEAD_NOTE, stackDots, VerdictPanel } from "./VerdictPanel";

describe("verdictClass", () => {
  it("uses the threshold when the uncertainty band clears it", () => {
    expect(verdictClass(0.9, 0.5, 0.05, "A")).toBe("planet");
    expect(verdictClass(0.1, 0.5, 0.05, "A")).toBe("false_positive");
    expect(verdictClass(0.5, 0.5)).toBe("planet"); // p ≥ threshold
  });
  it("is uncertain when the band straddles the threshold", () => {
    expect(verdictClass(0.53, 0.5, 0.05)).toBe("uncertain");
    expect(verdictClass(0.47, 0.5, 0.05)).toBe("uncertain");
  });
  it("is uncertain for grade-D inputs or a missing probability", () => {
    expect(verdictClass(0.99, 0.5, 0.01, "D")).toBe("uncertain");
    expect(verdictClass(null, 0.5)).toBe("uncertain");
    expect(verdictClass(Number.NaN, 0.5)).toBe("uncertain");
  });
});

describe("VerdictPanel", () => {
  it("always shows the research-lead note", () => {
    render(<VerdictPanel probability={0.97} threshold={0.5} />);
    expect(screen.getByTestId("research-lead-note")).toHaveTextContent(RESEARCH_LEAD_NOTE);
    expect(RESEARCH_LEAD_NOTE).toBe("Research lead — not a confirmed discovery");
  });

  it("renders a planet-like verdict with probability, threshold, members and band", () => {
    render(
      <VerdictPanel
        probability={0.874}
        threshold={0.42}
        uncertainty={0.05}
        memberProbabilities={[0.83, 0.86, 0.88, 0.9, 0.91]}
        qualityGrade="A"
        modelName="two-view CNN"
      />,
    );
    const panel = screen.getByRole("region", { name: "Model verdict" });
    expect(within(panel).getAllByText("Planet-like").length).toBeGreaterThan(0);
    expect(within(panel).getByText("0.874")).toBeInTheDocument();
    expect(within(panel).getByText(/decision threshold/)).toHaveTextContent("decision threshold 0.42");
    expect(within(panel).getAllByTestId("member-dot")).toHaveLength(5);
    expect(within(panel).getByTestId("uncertainty-band")).toBeInTheDocument();
    const scale = within(panel).getByTestId("verdict-scale");
    expect(scale).toHaveAttribute("aria-label", "Calibrated probability 0.874 ± 0.050, threshold 0.420");
    // Needle position = probability along the 0–1 scale.
    expect(within(panel).getByTestId("probability-needle")).toHaveStyle({ left: "87.4%" });
  });

  it("shows the quality grade and the catalogue classification side by side", () => {
    render(
      <VerdictPanel
        probability={0.9}
        threshold={0.5}
        qualityGrade="B"
        catalogue={{ disposition: "FALSE POSITIVE", cls: "false_positive", source: "KOI cumulative" }}
      />,
    );
    expect(screen.getByText("FALSE POSITIVE")).toBeInTheDocument();
    expect(screen.getByText("False-positive-like")).toBeInTheDocument();
    expect(screen.getByText(/Quality Grade B/)).toBeInTheDocument();
    expect(screen.getByText("Model disagrees with catalogue")).toBeInTheDocument();
  });

  it("reads as uncertain when the band straddles the threshold", () => {
    render(<VerdictPanel probability={0.52} threshold={0.5} uncertainty={0.08} />);
    expect(screen.getByText("Uncertain")).toBeInTheDocument();
    expect(screen.queryByText("Planet-like")).toBeNull();
  });

  it("flags fixture models and training-set signals", () => {
    render(<VerdictPanel probability={0.8} threshold={0.5} isFixtureModel seenInSplit="train" />);
    expect(screen.getByText("Fixture model")).toBeInTheDocument();
    expect(screen.getByText("Seen during training")).toBeInTheDocument();
  });

  it("handles a missing probability without a needle", () => {
    render(<VerdictPanel probability={null} threshold={0.5} />);
    expect(screen.queryByTestId("probability-needle")).toBeNull();
    expect(screen.getByTestId("verdict-scale")).toHaveAttribute("aria-label", "No probability available");
    expect(screen.getByText("Uncertain")).toBeInTheDocument();
  });
});

describe("stackDots (ensemble-member beeswarm)", () => {
  it("keeps well-separated members on one row", () => {
    expect(stackDots([0.1, 0.5, 0.9], 0.02)).toEqual([0, 0, 0]);
  });
  it("stacks members closer than the minimum separation, in input order", () => {
    // 0.905 sits within 0.02 of 0.90, so it moves up a row; 0.95 clears row 0 again.
    expect(stackDots([0.905, 0.9, 0.3, 0.95], 0.02)).toEqual([1, 0, 0, 0]);
    expect(stackDots([0.9, 0.901, 0.902], 0.02)).toEqual([0, 1, 2]);
  });
  it("falls back to overlapping on row 0 once the row budget is used", () => {
    expect(stackDots([0.5, 0.5, 0.5, 0.5], 0.02, 3)).toEqual([0, 1, 2, 0]);
  });
  it("is deterministic for ties", () => {
    expect(stackDots([0.4, 0.4], 0.05)).toEqual([0, 1]);
  });
});

describe("VerdictPanel catalogue column", () => {
  it("labels the archive disposition without repeating the provenance chip text", () => {
    render(<VerdictPanel probability={0.9} threshold={0.5} catalogue={{ disposition: "CANDIDATE", cls: null }} />);
    expect(screen.getByText("Disposition")).toBeInTheDocument();
    expect(screen.getByText("Catalogue")).toHaveAttribute("data-provenance", "catalogue");
  });
});

describe("ProvenanceTable", () => {
  it("flags tension in combined sigma and announces missing values", () => {
    render(
      <ProvenanceTable
        rows={[
          { quantity: "Duration T14", unit: "h", catalogue: { value: 3.05, err: 0.04 }, measured: { value: 3.42, err: 0.06 } },
          { quantity: "Planet radius", unit: "R⊕", catalogue: { value: 2.4, err: 0.3 } },
        ]}
      />,
    );
    // |3.42 − 3.05| / √(0.06² + 0.04²) ≈ 5.1σ → tension.
    expect(screen.getByText("5.1σ")).toBeInTheDocument();
    expect(screen.getByText("(tension)")).toBeInTheDocument();
    // Missing measured / estimate / agreement cells are announced, not silent dashes.
    expect(screen.getAllByText("not available").length).toBeGreaterThanOrEqual(3);
    expect(agreement({ value: 2, err: null }, { value: 1, err: null })).toEqual({ text: "×2.00", tension: false });
  });
});
