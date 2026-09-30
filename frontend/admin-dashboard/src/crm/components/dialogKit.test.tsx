/** The shared decision dialog (30 Sep 2026): a required reason blocks the
 *  confirm, a quick pick fills the reason, and a server refusal is said
 *  inside the dialog with the button re-enabled. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { XCircle, BellRing } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { DecisionDialog, type DecisionSpec } from "./dialogKit";

const spec: DecisionSpec = {
  tone: "rose", icon: XCircle, eyebrow: "Close the candidacy", title: "Reject the candidate",
  intro: "Closes the candidacy.",
  reason: { label: "Reason", required: true, min: 5, picks: ["Skills do not match the JD"] },
  happens: [{ icon: BellRing, text: "RMG and GM are told." }],
  confirmLabel: "Reject candidate",
};

describe("DecisionDialog", () => {
  it("needs the reason, takes a quick pick, posts the note", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<DecisionDialog spec={spec} person={{ name: "G. Thejo" }} onConfirm={onConfirm} onClose={() => {}} />);
    expect(screen.getByText("G. Thejo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Reject candidate/ }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("at least 5 characters");
    fireEvent.click(screen.getByRole("button", { name: "Skills do not match the JD" }));
    fireEvent.click(screen.getByRole("button", { name: /Reject candidate/ }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("Skills do not match the JD"));
  });

  it("shows the server's refusal and lets you try again", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("Only at Sourcing"));
    render(<DecisionDialog spec={{ ...spec, reason: { label: "Note" } }} onConfirm={onConfirm} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Reject candidate/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Only at Sourcing"));
    expect(screen.getByRole("button", { name: /Reject candidate/ })).not.toBeDisabled();
  });
});
