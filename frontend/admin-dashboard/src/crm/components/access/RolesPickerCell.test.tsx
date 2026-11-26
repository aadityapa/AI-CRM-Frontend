import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RolesPickerCell, pickerProblem, rolesPickerLabel, samePicked } from "./RolesPickerCell";

const ROLES = [
  { id: 1, name: "Employee", is_active: true },
  { id: 2, name: "Interviewer", is_active: true },
  { id: 3, name: "GM", is_active: true },
];

describe("RolesPickerCell helpers", () => {
  it("labels several custom roles, else the built-in ones", () => {
    expect(rolesPickerLabel(["Employee", "Interviewer"], [])).toBe("Employee + Interviewer");
    expect(rolesPickerLabel([], ["Sales_Head"])).toBe("Built-in role (Sales Head)");
    expect(rolesPickerLabel([], [])).toBe("Pick roles…");
  });

  it("needs a change and at least one role", () => {
    expect(samePicked([1, 2], [2, 1])).toBe(true);
    expect(pickerProblem([1], [1], [])).toBe("Nothing changed");
    expect(pickerProblem([], [1], [])).toMatch(/at least one role/);
    expect(pickerProblem([], [1], ["TA"])).toBe("");
    expect(pickerProblem([1, 2], [1], [])).toBe("");
  });
});

describe("RolesPickerCell", () => {
  it("saves two custom roles together", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <RolesPickerCell userName="Test Emp" builtin={[]} customNames={["Employee"]} roles={ROLES} onSave={onSave} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Roles for Test Emp/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Interviewer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([1, 2]));
  });
});
