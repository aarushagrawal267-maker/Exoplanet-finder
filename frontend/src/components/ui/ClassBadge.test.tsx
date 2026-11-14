import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClassBadge, classFromLabel } from "./ClassBadge";

describe("ClassBadge", () => {
  it.each([
    ["planet", "Planet-like"],
    ["false_positive", "False-positive-like"],
    ["uncertain", "Uncertain"],
  ] as const)("renders %s with text and an icon, not colour alone", (cls, label) => {
    const { container } = render(<ClassBadge cls={cls} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.firstElementChild).toHaveAttribute("data-class", cls);
  });

  it("never says 'planet' or 'confirmed' on its own", () => {
    render(<ClassBadge cls="planet" />);
    expect(screen.queryByText(/^planet$/i)).toBeNull();
    expect(screen.queryByText(/confirmed/i)).toBeNull();
  });

  it("appends a formatted probability in mono", () => {
    render(<ClassBadge cls="planet" probability={0.87314} />);
    const p = screen.getByText("· 0.873");
    expect(p).toHaveClass("num");
  });

  it("adds a screen-reader context prefix", () => {
    render(<ClassBadge cls="false_positive" context="Catalogue label" />);
    expect(screen.getByText(/Catalogue label/)).toHaveClass("sr-only");
  });

  it("maps binary labels to classes", () => {
    expect(classFromLabel(1)).toBe("planet");
    expect(classFromLabel(0)).toBe("false_positive");
    expect(classFromLabel(null)).toBe("uncertain");
    expect(classFromLabel(undefined)).toBe("uncertain");
  });
});
