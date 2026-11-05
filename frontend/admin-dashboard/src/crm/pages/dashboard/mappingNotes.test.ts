import { describe, expect, it } from "vitest";
import { COUNTED_BY_OPTIONS, mappingNotes } from "./CeoDashboard";

describe("mappingNotes", () => {
  it("lists only the months whose Collected moved after they closed, newest change first", () => {
    const notes = mappingNotes([
      { label: "Jul 26", mapping_changed_on: "2026-09-12", mapped_later: 50000 },
      { label: "Aug 26", mapping_changed_on: null, mapped_later: 0 },
      { label: "Sep 26", mapping_changed_on: "2026-10-30", mapped_later: 125000 },
      { label: "Oct 26" },
    ]);
    expect(notes.map((n) => n.label)).toEqual(["Sep 26", "Jul 26"]);
    expect(notes[0]).toEqual({ label: "Sep 26", on: "2026-10-30", amount: 125000 });
  });

  it("offers the two ways of counting", () => {
    expect(COUNTED_BY_OPTIONS.map((o) => o.key)).toEqual(["work", "cash"]);
  });
});
