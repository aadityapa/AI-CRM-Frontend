/**
 * 24 Oct 2026 — the redesigned Opportunities row: only a team assigner gets
 * buttons on the Sourcing team; everyone else sees it read-only. The Actions
 * cell keeps the same rights (Apply · Edit · Delete) behind one main button,
 * Edit and a ⋯ menu.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { FilledCell, OppRowActions, TeamCell } from "./OpportunityRowParts";

const ta = [{ id: 1, user_id: 11, name: "Gargee Joshi" }];
const hm = [{ id: 2, user_id: 22, name: "Raju Gaikwad" }];
const noop = () => {};

describe("TeamCell", () => {
  it("is read-only without the assign right — no buttons, a dash for nobody", () => {
    render(<TeamCell requirementId={5} label="C-1" tas={ta} hms={[]} canAssign={false}
      onTas={noop} onHms={noop} toast={noop} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("GJ")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("gives an assigner a button per role (Change for a filled one, Assign for an empty one)", () => {
    render(<TeamCell requirementId={5} label="C-1" tas={ta} hms={[]} canAssign
      onTas={noop} onHms={noop} toast={noop} />);
    expect(screen.getByRole("button", { name: "Change TAs" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Assign Hiring Manager" })).toBeTruthy();
  });

  it("says the position comes after approval when there is none yet", () => {
    render(<TeamCell requirementId={null} label="C-1" canAssign onTas={noop} onHms={noop} toast={noop} />);
    expect(screen.getByText("After approval")).toBeTruthy();
  });
});

describe("FilledCell", () => {
  it("prints filled of total and the open count", () => {
    render(<FilledCell total={5} joined={2} open={3} />);
    expect(screen.getByText("of 5 filled")).toBeTruthy();
    expect(screen.getByText(/3 open/)).toBeTruthy();
  });
});

describe("OppRowActions", () => {
  const base = {
    id: 9, label: "C-2026-00071", title: "Linux Kernel Engineer", requirementId: 5,
    onApply: vi.fn(), onEdit: vi.fn(), onTas: noop, onHms: noop, onDeleted: noop, toast: noop,
  };

  it("TA: Apply as the main button, no team items, no Edit / Delete", () => {
    render(<OppRowActions {...base} tas={ta} hms={hm} canAssignTeam={false} canApply canWrite={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Apply a candidate/ }));
    expect(base.onApply).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /More actions/ }));
    expect(screen.queryByRole("menuitem", { name: /TAs/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Delete/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Open in new tab/ })).toBeTruthy();
  });

  it("RMG / GM with nobody sourcing: Assign TAs is the main button; team items in the menu", () => {
    render(<OppRowActions {...base} tas={[]} hms={[]} canAssignTeam canApply canWrite={false} />);
    expect(screen.getByRole("button", { name: /Assign TAs/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /More actions/ }));
    expect(screen.getByRole("menuitem", { name: /Assign Hiring Manager/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Apply a candidate/ })).toBeTruthy();
  });

  it("Sales: Edit beside the menu, Delete at the bottom of it", () => {
    render(<OppRowActions {...base} tas={ta} hms={hm} canAssignTeam={false} canApply={false} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    expect(base.onEdit).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /More actions/ }));
    const items = screen.getAllByRole("menuitem").map((b) => b.textContent);
    expect(items[items.length - 1]).toMatch(/Delete opportunity/);
  });
});
