/** The profile's Next-step buttons (28 Sep 2026): the server's allowed moves,
 *  named and ordered — they replaced the Change Status dropdown. */
import { describe, expect, it } from "vitest";

import { stageActions } from "./StageActions";

describe("stageActions", () => {
  it("gives Sales at Sales Screening: Customer Screening, Sales Rejected, Self Withdraw", () => {
    const got = stageActions("Sales_Screening", ["Self_Withdrawn", "Rejected", "Sales_Rejected", "Customer_Screening"]);
    expect(got.map((a) => [a.label, a.kind])).toEqual([
      ["Customer Screening", "forward"],
      ["Sales Rejected", "reject"],
      ["Self Withdraw", "withdraw"],
    ]);
  });
  it("keeps the generic Reject when no stage-specific rejection exists", () => {
    expect(stageActions("Preboarding", ["Joined", "Rejected"]).map((a) => a.label)).toEqual(["Joined", "Reject"]);
  });
  it("names a backward move and leaves out what a panel already offers", () => {
    const got = stageActions("Customer_Screening", ["Customer_Interview", "Sales_Screening", "Customer_Screen_Rejected"]);
    expect(got.find((a) => a.status === "Sales_Screening")?.kind).toBe("back");
    expect(stageActions("RMG_Review", ["Sales_Screening", "RMG_Rejected", "Self_Withdrawn"], ["Sales_Screening", "RMG_Rejected"])
      .map((a) => a.status)).toEqual(["Self_Withdrawn"]);
  });
});
