import { describe, expect, it } from "vitest";
import {
  PROCTORING_OFF,
  PROCTORING_RECOMMENDED,
  proctoringCount,
  proctoringFromWeights,
  proctoringSetupMinutes,
  proctoringToWeights,
} from "./ProctoringSettings";
import { proctoringVerdict } from "../candidate-report/ProctoringSummary";
import { isInLobby, terminateSpec } from "../interview-live/LiveJoinPanel";

describe("anti-cheating template switches (13 Nov 2026)", () => {
  it("reads nothing as all off and round-trips the server's keys", () => {
    expect(proctoringFromWeights({})).toEqual(PROCTORING_OFF);
    expect(proctoringFromWeights({ proctoring: { headphones: "loud", gesture_prompts: 9, room_scan: "true" } }))
      .toMatchObject({ headphones: "off", gesturePrompts: 5, roomScan: true });
    const back = proctoringFromWeights({ proctoring: proctoringToWeights(PROCTORING_RECOMMENDED) });
    expect(back).toEqual(PROCTORING_RECOMMENDED);
    expect(proctoringCount(PROCTORING_OFF)).toBe(0);
    expect(proctoringCount(PROCTORING_RECOMMENDED)).toBe(6);
    expect(proctoringSetupMinutes(PROCTORING_RECOMMENDED)).toBeGreaterThan(1);
  });

  it("the report verdict and the live panel's lobby rule", () => {
    expect(proctoringVerdict({ flags: [] }, null).tone).toBe("ok");
    expect(proctoringVerdict({ flags: ["Missed 1 of 2 gesture prompt(s)"] }, null).tone).toBe("warn");
    expect(proctoringVerdict(null, { terminated: { reason: "Phone", by: "Asha", at: 1 } }).tone).toBe("bad");
    expect(isInLobby({ session_status: "pending", lobby: { stage: "device_check", words: "", at: 0, first_at: 0, online: true } })).toBe(true);
    expect(isInLobby({ session_status: "active", lobby: null })).toBe(false);
    expect(isInLobby({ session_status: "verified", lobby: { stage: "interview", words: "", at: 0, first_at: 0, online: true } })).toBe(false);
    expect(terminateSpec(true).reason.required).toBe(true);
    expect(terminateSpec(false).happens.length).toBeGreaterThan(2);
  });
});
