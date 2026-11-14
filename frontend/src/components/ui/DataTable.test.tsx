import type { ColumnDef } from "@tanstack/react-table";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DataTable } from "./DataTable";

interface Row {
  id: string;
  name: string;
  period: number | undefined;
}

const rows: Row[] = [
  { id: "a", name: "Beta", period: 10.5 },
  { id: "b", name: "Alpha", period: 2.2 },
  { id: "c", name: "Gamma", period: undefined },
  { id: "d", name: "Delta", period: 120 },
];

const columns: ColumnDef<Row>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "period", header: "Period", meta: { numeric: true }, cell: (c) => c.getValue<number | undefined>() ?? "—" },
];

function bodyNames(): string[] {
  const table = screen.getByRole("table", { name: "Test table" });
  const bodyRows = within(table).getAllByRole("row").slice(1); // drop header row
  return bodyRows.map((r) => (within(r).getAllByRole("cell")[0] as HTMLElement).textContent ?? "");
}

describe("DataTable", () => {
  it("renders rows in data order by default", () => {
    render(<DataTable caption="Test table" data={rows} columns={columns} getRowId={(r) => r.id} />);
    expect(bodyNames()).toEqual(["Beta", "Alpha", "Gamma", "Delta"]);
  });

  it("sorts text columns ascending first and toggles to descending", async () => {
    const user = userEvent.setup();
    render(<DataTable caption="Test table" data={rows} columns={columns} />);
    const header = screen.getByRole("columnheader", { name: /Name/ });
    expect(header).toHaveAttribute("aria-sort", "none");
    await user.click(within(header).getByRole("button"));
    expect(bodyNames()).toEqual(["Alpha", "Beta", "Delta", "Gamma"]);
    expect(header).toHaveAttribute("aria-sort", "ascending");
    await user.click(within(header).getByRole("button"));
    expect(bodyNames()).toEqual(["Gamma", "Delta", "Beta", "Alpha"]);
    expect(header).toHaveAttribute("aria-sort", "descending");
  });

  it("sorts numeric columns descending first and keeps missing values last", async () => {
    const user = userEvent.setup();
    render(<DataTable caption="Test table" data={rows} columns={columns} />);
    const header = screen.getByRole("columnheader", { name: /Period/ });
    await user.click(within(header).getByRole("button"));
    expect(header).toHaveAttribute("aria-sort", "descending");
    expect(bodyNames()).toEqual(["Delta", "Beta", "Alpha", "Gamma"]);
    await user.click(within(header).getByRole("button"));
    expect(header).toHaveAttribute("aria-sort", "ascending");
    expect(bodyNames()).toEqual(["Alpha", "Beta", "Delta", "Gamma"]);
  });

  it("right-aligns numeric cells in mono", () => {
    render(<DataTable caption="Test table" data={rows} columns={columns} />);
    const cell = screen.getByText("10.5").closest("td");
    expect(cell).toHaveClass("text-right", "num");
  });

  it("honours an initial sort", () => {
    render(<DataTable caption="Test table" data={rows} columns={columns} initialSorting={[{ id: "period", desc: false }]} />);
    expect(bodyNames()).toEqual(["Alpha", "Beta", "Delta", "Gamma"]);
  });

  it("toggles density", async () => {
    const user = userEvent.setup();
    render(<DataTable caption="Test table" data={rows} columns={columns} />);
    const compact = screen.getByRole("radio", { name: "Compact rows" });
    await user.click(compact);
    expect(compact).toHaveAttribute("aria-checked", "true");
    const firstRow = screen.getAllByRole("row")[1] as HTMLElement;
    expect(firstRow.style.height).toBe("32px");
  });

  it("shows an empty state", () => {
    render(<DataTable caption="Test table" data={[]} columns={columns} emptyTitle="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("marks the selected row as the current item (valid ARIA for a plain table)", () => {
    render(<DataTable caption="Test table" data={rows} columns={columns} getRowId={(r) => r.id} selectedRowId="b" />);
    const table = screen.getByRole("table", { name: "Test table" });
    const bodyRows = within(table).getAllByRole("row").slice(1);
    const current = bodyRows.filter((r) => r.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Alpha");
    for (const r of bodyRows) expect(r).not.toHaveAttribute("aria-selected");
  });

  it("calls onRowClick with the row (mouse and Enter key)", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(<DataTable caption="Test table" data={rows} columns={columns} onRowClick={onRowClick} />);
    await user.click(screen.getByText("Alpha"));
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
    const row = screen.getByText("Delta").closest("tr") as HTMLElement;
    row.focus();
    await user.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenLastCalledWith(rows[3]);
  });
});
