import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  KeyValueList,
  Modal,
  NumberInput,
  PageHeader,
  ProgressBar,
  ProvenanceChip,
  Readout,
  SegmentedControl,
  Select,
  Slider,
  Stepper,
  Switch,
  Tabs,
  Tooltip,
} from "./index";

describe("Button", () => {
  it("defaults to type=button and fires onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Run</Button>);
    const btn = screen.getByRole("button", { name: "Run" });
    expect(btn).toHaveAttribute("type", "button");
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });
  it("is disabled and busy while loading", () => {
    render(<Button loading>Train</Button>);
    const btn = screen.getByRole("button", { name: "Train" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });
  it("hides children for icon-only buttons but keeps the aria-label", () => {
    render(<Button iconOnly aria-label="Settings" icon={<svg />} />);
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });
});

describe("ProvenanceChip", () => {
  it.each([
    ["catalogue", "Catalogue"],
    ["measured", "Measured"],
    ["estimate", "Estimate"],
    ["model", "Model"],
    ["manual", "Manual"],
  ] as const)("labels %s with text", (kind, label) => {
    const { container } = render(<ProvenanceChip kind={kind} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("data-provenance", kind);
  });
  it("uses a dashed border for estimates", () => {
    const { container } = render(<ProvenanceChip kind="estimate" />);
    expect(container.firstElementChild).toHaveClass("border-dashed");
  });
  it("exposes the source to assistive tech", () => {
    render(<ProvenanceChip kind="catalogue" source="KOI cumulative 2026-11-14" />);
    expect(screen.getByText(/KOI cumulative 2026-11-14/)).toHaveClass("sr-only");
  });
});

describe("Readout / Badge / PageHeader / KeyValueList", () => {
  it("renders a readout with value, unit, error and provenance", () => {
    render(<Readout label="Depth" value="6,712" unit="ppm" error="45" provenance="measured" />);
    expect(screen.getByText("Depth")).toBeInTheDocument();
    expect(screen.getByText("6,712")).toHaveClass("num");
    // Error and unit form one non-wrapping group so "ppm" never lands alone on a line.
    expect(screen.getByText("± 45 ppm")).toHaveClass("whitespace-nowrap", "num");
    expect(screen.getByText("Measured")).toBeInTheDocument();
  });
  it("renders a unit alone when there is no error", () => {
    render(<Readout label="Period" value="2.2047" unit="d" />);
    expect(screen.getByText("d")).toHaveClass("num");
  });
  it("renders badges with text", () => {
    render(<Badge tone="warn" dot>Conflict</Badge>);
    expect(screen.getByText("Conflict")).toBeInTheDocument();
  });
  it("renders a page header with an h1 title", () => {
    render(<PageHeader eyebrow="Observe · 01" title="Overview" description="Hello" actions={<button type="button">Go</button>} />);
    expect(screen.getByRole("heading", { level: 1, name: "Overview" })).toHaveClass("font-display");
    expect(screen.getByText("Observe · 01")).toBeInTheDocument();
  });
  it("renders a definition list", () => {
    render(<KeyValueList items={[{ key: "p", label: "Period", value: "2.2047 d", provenance: "catalogue" }]} />);
    expect(screen.getByText("Period").tagName).toBe("DT");
    expect(screen.getByText("2.2047 d").closest("dd")).toHaveClass("num");
  });
});

describe("Field wiring", () => {
  it("associates label, help and error with the control", () => {
    render(
      <Field label="Batch size" help="Power of two" error="Too large">
        <Input defaultValue="1024" />
      </Field>,
    );
    const input = screen.getByLabelText("Batch size");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Too large Power of two");
  });
  it("works with Select", async () => {
    const onChange = vi.fn();
    render(
      <Field label="Method">
        <Select value="spline" onChange={onChange} options={[{ value: "spline", label: "Spline" }, { value: "savgol", label: "Savitzky–Golay" }]} />
      </Field>,
    );
    await userEvent.selectOptions(screen.getByLabelText("Method"), "savgol");
    expect(onChange).toHaveBeenCalledWith("savgol");
  });
});

describe("Switch", () => {
  it("toggles and exposes role=switch", async () => {
    function Harness() {
      const [on, setOn] = useState(false);
      return <Switch checked={on} onChange={setOn} label="Ensemble" />;
    }
    render(<Harness />);
    const sw = screen.getByRole("switch", { name: "Ensemble" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    await userEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");
  });
});

describe("SegmentedControl & Tabs keyboard support", () => {
  it("moves the selection with arrow keys", async () => {
    function Harness() {
      const [v, setV] = useState<"a" | "b" | "c">("a");
      return (
        <SegmentedControl
          aria-label="Split"
          value={v}
          onChange={setV}
          options={[
            { value: "a", label: "Train" },
            { value: "b", label: "Val" },
            { value: "c", label: "Test" },
          ]}
        />
      );
    }
    render(<Harness />);
    const train = screen.getByRole("radio", { name: "Train" });
    train.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Val" })).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Test" })).toHaveAttribute("aria-checked", "true");
  });

  it("switches tab panels and skips disabled tabs", async () => {
    render(
      <Tabs
        aria-label="Views"
        items={[
          { id: "one", label: "One", content: <p>Panel one</p> },
          { id: "off", label: "Off", disabled: true, content: <p>never</p> },
          { id: "two", label: "Two", content: <p>Panel two</p> },
        ]}
      />,
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel one");
    screen.getByRole("tab", { name: "One" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel two");
    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "One" })).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Two" })).toHaveFocus();
  });
  it("draws the tab baseline without overflowing the scrollable tablist", () => {
    render(<Tabs aria-label="Views" items={[{ id: "a", label: "A" }, { id: "b", label: "B" }]} />);
    // Regression: tabs with -mb-px hung 1 px into the tablist border, which (with overflow-x
    // auto) made the tablist vertically scrollable and showed a stray scrollbar on Windows.
    const list = screen.getByRole("tablist", { name: "Views" });
    expect(list).toHaveClass("overflow-y-hidden");
    for (const tab of screen.getAllByRole("tab")) expect(tab.className).not.toMatch(/-mb-px/);
  });
});

describe("NumberInput & Slider", () => {
  function NumberHarness({ onValue }: { onValue: (v: number | null) => void }) {
    const [v, setV] = useState<number | null>(2.2);
    return (
      <NumberInput
        aria-label="Period"
        value={v}
        min={0.5}
        max={100}
        step={0.1}
        onChange={(x) => {
          setV(x);
          onValue(x);
        }}
      />
    );
  }

  it("commits typed numbers and clamps to range on blur", async () => {
    const onValue = vi.fn();
    render(<NumberHarness onValue={onValue} />);
    const input = screen.getByRole("spinbutton", { name: "Period" });
    await userEvent.clear(input);
    await userEvent.type(input, "3.5");
    expect(onValue).toHaveBeenLastCalledWith(3.5);
    await userEvent.clear(input);
    await userEvent.type(input, "500");
    fireEvent.blur(input);
    expect(onValue).toHaveBeenLastCalledWith(100);
    expect(input).toHaveValue("100.0");
  });

  it("steps with arrow keys and stepper buttons", async () => {
    const onValue = vi.fn();
    render(<NumberHarness onValue={onValue} />);
    const input = screen.getByRole("spinbutton", { name: "Period" });
    await userEvent.click(input);
    await userEvent.keyboard("{ArrowUp}");
    expect(onValue).toHaveBeenLastCalledWith(2.3);
    await userEvent.click(screen.getByRole("button", { name: "Decrease" }));
    expect(onValue).toHaveBeenLastCalledWith(2.2);
  });

  it("keeps slider and numeric input in sync", () => {
    function Harness() {
      const [v, setV] = useState(0.5);
      return <Slider aria-label="Threshold" value={v} onChange={setV} min={0} max={1} step={0.01} />;
    }
    render(<Harness />);
    const range = screen.getByRole("slider", { name: "Threshold" });
    fireEvent.change(range, { target: { value: "0.73" } });
    expect(screen.getByRole("spinbutton", { name: "Threshold (exact)" })).toHaveValue("0.73");
  });
});

describe("Feedback", () => {
  it("ProgressBar exposes value and ETA", () => {
    render(<ProgressBar value={0.42} label="Training" etaSeconds={185} />);
    const bar = screen.getByRole("progressbar", { name: "Training" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuetext", "42%, about 3 min 05 s left");
    expect(screen.getByText("about 3 min 05 s left")).toBeInTheDocument();
  });
  it("ProgressBar supports indeterminate state", () => {
    render(<ProgressBar value={null} label="Waiting" />);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "In progress");
    // Under reduced motion the sweeping segment becomes a faint full-width fill, never a parked
    // 1/3 segment that would read as "33 % done".
    expect(screen.getByTestId("progress-indeterminate")).toHaveClass("motion-reduce:w-full", "motion-reduce:animate-none");
  });
  it("Banner uses alert for danger and status otherwise", () => {
    render(
      <>
        <Banner tone="danger" title="Failed" />
        <Banner tone="fixture-model" title="Fixture" />
      </>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Failed");
    expect(screen.getByRole("status")).toHaveTextContent("Fixture");
  });
  it("ErrorState explains a network ApiError and retries", async () => {
    const onRetry = vi.fn();
    render(<ErrorState error={new ApiError(0, "Cannot reach", { hint: "Start the backend" })} onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The analysis server is not responding");
    expect(screen.getByText("Likely cause")).toBeInTheDocument();
    expect(screen.getByText("Start the backend")).toBeInTheDocument();
    expect(screen.getByText("Technical details")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
  it("EmptyState renders title and actions", () => {
    render(<EmptyState title="No models" actions={<button type="button">Train</button>} />);
    expect(screen.getByRole("heading", { name: "No models" })).toBeInTheDocument();
  });
  it("Stepper marks the current step", () => {
    render(
      <Stepper
        steps={[
          { id: "a", label: "Download", status: "complete" },
          { id: "b", label: "Train", status: "current" },
        ]}
      />,
    );
    expect(screen.getByText("Train").closest("li")).toHaveAttribute("aria-current", "step");
  });
});

describe("Overlays", () => {
  it("Modal traps focus, closes on Escape and restores focus", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Modal open={open} onClose={() => setOpen(false)} title="Delete dataset?">
            <button type="button">Inside</button>
          </Modal>
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    await userEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Delete dataset?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("Tooltip appears on focus and links via aria-describedby", async () => {
    vi.useFakeTimers();
    try {
      render(
        <Tooltip content="Box Least Squares" delayMs={50}>
          <button type="button">BLS</button>
        </Tooltip>,
      );
      const btn = screen.getByRole("button", { name: "BLS" });
      act(() => btn.focus());
      act(() => {
        vi.advanceTimersByTime(60);
      });
      const tip = screen.getByRole("tooltip");
      expect(tip).toHaveTextContent("Box Least Squares");
      expect(btn).toHaveAttribute("aria-describedby", tip.id);
      act(() => btn.blur());
      expect(screen.queryByRole("tooltip")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
