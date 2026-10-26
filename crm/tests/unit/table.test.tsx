import {
  columnVisibilityFeature,
  flexRender,
  rowSelectionFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowSelectionState,
} from "@tanstack/react-table";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

/** Same table setup as the leads table (src/components/leads/leads-table.tsx), on TanStack Table v9. */
const features = tableFeatures({ rowSelectionFeature, columnVisibilityFeature });
type Row = { id: string; name: string; owner: string };
const columns: ColumnDef<typeof features, Row>[] = [
  { id: "name", header: "Name", cell: ({ row }) => row.original.name },
  { id: "owner", header: "Owner", cell: ({ row }) => row.original.owner },
];
const rows: Row[] = [
  { id: "a", name: "Acme Dental", owner: "Ana" },
  { id: "b", name: "Bay Legal", owner: "Ben" },
];

function Table({ selected }: { selected: RowSelectionState }) {
  const table = useTable({
    features,
    data: rows,
    columns,
    getRowId: (r) => r.id,
    state: { rowSelection: selected, columnVisibility: { owner: false } },
  });
  return (
    <table>
      <thead>
        {table.getHeaderGroups().map((g) => (
          <tr key={g.id}>
            {g.headers.map((h) => (
              <th key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id} data-selected={row.getIsSelected()}>
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
            ))}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td>{table.getIsAllPageRowsSelected() ? "all" : "not-all"}</td>
        </tr>
      </tfoot>
    </table>
  );
}

describe("leads table setup (TanStack Table v9)", () => {
  it("renders every row without a core row model option, and hides hidden columns", () => {
    const html = renderToStaticMarkup(<Table selected={{}} />);
    expect(html).toContain("Acme Dental");
    expect(html).toContain("Bay Legal");
    expect(html).toContain("<th>Name</th>");
    expect(html).not.toContain("Owner");
    expect(html).not.toContain("Ana");
  });

  it("reflects the selection state", () => {
    expect(renderToStaticMarkup(<Table selected={{ a: true }} />)).toMatch(/data-selected="true"><td>Acme Dental/);
    expect(renderToStaticMarkup(<Table selected={{ a: true }} />)).toContain("not-all");
    expect(renderToStaticMarkup(<Table selected={{ a: true, b: true }} />)).toContain(">all<");
  });
});
