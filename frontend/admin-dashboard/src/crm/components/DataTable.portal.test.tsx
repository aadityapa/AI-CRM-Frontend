/**
 * A dialog opened from a table cell is portalled to <body>, but React bubbles
 * its clicks through the component tree — closing it used to "click the row"
 * and navigate away (28 Sep 2026 report). Rows now act only on clicks inside
 * their own DOM (`isOwnDomClick`).
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { DataTable } from "./DataTable";
import { Modal } from "./ui";

describe("DataTable row clicks", () => {
  it("ignores clicks that come from a dialog opened inside a cell", () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        rows={[{ id: 1, name: "Akhil" }]}
        columns={[{ key: "name", label: "Name", render: (r: any) => (
          <>
            <span>{r.name}</span>
            <Modal title="Interviews" onClose={() => undefined}><p>inside</p></Modal>
          </>
        ) }]}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByText("inside"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onRowClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Akhil"));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });
});
