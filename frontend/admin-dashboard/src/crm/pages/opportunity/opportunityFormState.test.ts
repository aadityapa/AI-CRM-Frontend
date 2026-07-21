import { describe, expect, it } from "vitest";
import {
  activeDetails,
  applyBranchContactDetails,
  buildSubmitPayload,
  emptyState,
  setDetail,
  switchType,
} from "./opportunityFormState";

describe("opportunityFormState shared customer details", () => {
  it("mirrors shared detail keys into every type bucket when opp type is selected", () => {
    let state = emptyState();
    state = switchType(state, "T&M");
    state = setDetail(state, "contact_email", "pavan@honda.com");
    expect(state.detailsByType["T&M"]?.contact_email).toBe("pavan@honda.com");
    expect(state.detailsByType.Work_Package?.contact_email).toBe("pavan@honda.com");
  });

  it("activeDetails merges shared fields even when active bucket lacks them", () => {
    let state = emptyState();
    state = switchType(state, "Fixed_Price");
    state = setDetail(state, "contact_email", "pavan@honda.com");
    state = setDetail(state, "hiring_manager_email", "hm@honda.com");
    state = {
      ...state,
      detailsByType: {
        ...state.detailsByType,
        Fixed_Price: { ...(state.detailsByType.Fixed_Price || {}), contact_email: undefined },
      },
    };
    delete (state.detailsByType.Fixed_Price as Record<string, unknown>).contact_email;
    const details = activeDetails(state);
    expect(details.contact_email).toBe("pavan@honda.com");
    expect(details.hiring_manager_email).toBe("hm@honda.com");
  });

  it("applyBranchContactDetails writes emails and phones into state readable by activeDetails", () => {
    let state = emptyState();
    state = switchType(state, "T&M");
    state = {
      ...state,
      core: { ...state.core, customer_id: "3", branch_id: "3" },
    };
    state = applyBranchContactDetails(state, {
      contact_person_id: "3",
      hiring_manager_id: "4",
      contact_email: "pavan@honda.com",
      contact_phone: "+918767998766",
      hiring_manager_email: "pavan@honda.com",
      hiring_manager_contact: "+918767897654",
    });
    const details = activeDetails(state);
    expect(details.contact_email).toBe("pavan@honda.com");
    expect(details.hiring_manager_email).toBe("pavan@honda.com");
    expect(details.contact_phone).toBe("+918767998766");
    expect(details.hiring_manager_contact).toBe("+918767897654");
  });
});

describe("buildSubmitPayload sanitization", () => {
  it("coerces empty optional numbers/ids to null and drops incomplete skills", () => {
    let state = emptyState();
    state = switchType(state, "T&M");
    state = {
      ...state,
      core: {
        title: "  Harman Opp  ",
        customer_id: "9",
        branch_id: "6",
        contact_person_id: "9",
        hiring_manager_id: "",
        rfi_value: "",
        rfi_received_date: "2026-07-16",
        onboarding_status: "Sourcing",
        onboarded_count: "0",
      },
      skills: [{}, { skill_id: "12", required_level: "3", is_mandatory: true }],
      ctcSlab: [{}],
      version: 1,
    };
    state = setDetail(state, "contact_email", "a@b.com");
    state = setDetail(state, "tm_work_location", "Bangalore");
    state = setDetail(state, "contact_phone", "");

    const payload = buildSubmitPayload(state);
    expect(payload.customer_id).toBe(9);
    expect(payload.branch_id).toBe(6);
    expect(payload.contact_person_id).toBe(9);
    expect(payload.hiring_manager_id).toBeNull();
    expect(payload.rfi_value).toBeNull();
    expect(payload.title).toBe("Harman Opp");
    expect(payload.version).toBeUndefined();
    expect(payload.skills).toEqual([
      { skill_id: 12, is_mandatory: true, required_level: 3, comment: null },
    ]);
    expect(payload.ctc_slab).toEqual([]);
    const details = payload.details as Record<string, unknown>;
    expect(details.contact_email).toBe("a@b.com");
    expect(details.tm_work_location).toBe("Bangalore");
    expect(details.contact_phone).toBeUndefined();
  });

  it("coerces T&M CTC slab fields to API numbers", () => {
    let state = switchType(emptyState(), "T&M");
    state = {
      ...state,
      ctcSlab: [{
        exp_min: "3",
        exp_max: "5",
        target_exp: "",
        rate: "100",
        revenue_monthly: "15133.33",
        revenue_annual: "181600",
        management_cost_pct: "30",
        engineering_budget: "127120",
        hike_pct: "10",
        appraisal_cycle: "Annual",
        approved_ctc_lac: "115563.64",
      }],
    };
    const row = (buildSubmitPayload(state).ctc_slab as Record<string, unknown>[])[0];
    expect(row).toMatchObject({
      exp_min: 3,
      exp_max: 5,
      target_exp: null,
      rate: 100,
      revenue_annual: 181600,
      engineering_budget: 127120,
      approved_ctc_lac: 115563.64,
      appraisal_cycle: "Annual",
    });
  });

  it("submits Candidate CTC slabs for non-T&M opportunities", () => {
    const state = {
      ...switchType(emptyState(), "Retainer"),
      ctcSlab: [{ rate: 100 }],
    };
    expect(buildSubmitPayload(state).ctc_slab).toEqual([{
      exp_min: null,
      exp_max: null,
      target_exp: null,
      rate: 100,
      revenue_monthly: null,
      revenue_annual: null,
      management_cost_pct: null,
      engineering_budget: null,
      hike_pct: null,
      approved_ctc_lac: null,
      appraisal_cycle: null,
    }]);
  });
});
