/**
 * Plain-language explanations for every workflow status — what it means and
 * WHO must act next. Shown as a tooltip on StatusBadge (the ⓘ).
 *
 * This is the app's biggest learning curve made self-explanatory: nobody can
 * guess that "Pending Engineering Review" means "RMG must attach a JD", and
 * asking a colleague is how tribal knowledge stays tribal. Keep every entry to
 * one or two sentences, always naming the role that acts.
 *
 * Keys are the STORED status values (DB values), same as STATUS_LABEL_OVERRIDES.
 */
export const STATUS_HELP: Record<string, string> = {
  /* ---------------- Requirements ---------------- */
  Draft: "Being written — not yet submitted for approval.",
  Pending_Sales_Head_Approval: "Waiting for the Sales Head to approve or reject.",
  Pending_Engineering_Review:
    "Waiting for RMG to review, attach a Job Description and approve. TA cannot source until this is done.",
  Open_For_Sourcing: "Approved and ready — TA can start sourcing candidates now.",
  Posted_On_Portals: "The job has been posted on portals; applications are coming in.",
  In_Progress: "Candidates are being sourced and screened for this requirement.",
  Fulfilled: "All positions are filled. No further action.",
  Sales_Head_Rejected: "Rejected by the Sales Head — the creator can edit and resubmit.",
  Engineering_Rejected: "Rejected by RMG — the creator can edit and resubmit.",
  Closed: "Closed manually. No further action.",
  Cancelled: "Cancelled. No further action.",

  /* ---------------- Candidate pipeline ---------------- */
  Sourcing: "TA is finding candidates. TA moves them forward to Technical Screening.",
  Technical_Screening: "Technical evaluation in progress. TA moves the profile onward to RMG Review.",
  RMG_Review: "RMG is reviewing the candidate's fit. Only RMG can move the profile from here.",
  Sales_Screening: "Sales is screening before showing the candidate to the customer.",
  Customer_Screening: "The customer is reviewing the profile. Sales owns this stage.",
  Customer_Interview: "A customer interview is being arranged or has taken place.",
  L1_Feedback: "Waiting for the customer's L1 interview feedback. Sales or Sales Head records the outcome.",
  L2_Feedback: "Waiting for the customer's L2 interview feedback. Sales or Sales Head records the outcome.",
  Shortlisted: "The customer shortlisted this candidate. Next: offer, then Sales Head sign-off.",
  Customer_Approval:
    "The customer approved. Only the Sales Head can move the profile from here (an offer must exist) — deliberate four-eyes control.",
  Preboarding: "Offer accepted — HR is handling documents and the joining date.",
  Joined: "The candidate has joined. Final stage.",
  RMG_Rejected: "RMG rejected the candidate. Terminal.",
  Sales_Rejected: "Sales rejected the candidate. Terminal.",
  Customer_Rejected: "The customer rejected the candidate. Terminal.",
  Self_Withdrawn: "The candidate withdrew. Terminal.",

  /* ---------------- Timesheets ---------------- */
  Submitted:
    "Submitted and waiting for approval by RMG or Sales. HR can see it but does not approve.",
  Approved: "Approved. Finance or RMG can now generate the invoice from it.",
  Rejected: "Sent back with a reason — the employee edits and resubmits.",
  Due: "This month is owed but no timesheet was created yet. The employee should create and fill it.",

  /* ---------------- Opportunities ---------------- */
  New: "Just created. Move it to Active when work on the deal starts.",
  Active: "Being actively pursued.",
  On_Hold: "Paused — can be reactivated.",
  Closed_Won: "Won. A project can be created from it.",
  Closed_Lost: "Lost. Terminal unless archived.",
  Closed_Partial: "Partially won.",
  Archived: "Archived by the Sales Head. Terminal.",

  /* ---------------- POs & Invoices ---------------- */
  Exhausted: "The full PO value has been invoiced. Renew it to continue billing.",
  Unpaid: "No payment received yet.",
  Partially_Paid: "Some payment received; a balance is still outstanding.",
  Paid: "Fully paid. No further action.",

  /* ---------------- Leave / misc ---------------- */
  Pending: "Waiting for HR to approve or reject.",

  /* ---------------- Template requests ---------------- */
  Pending_RMG: "TA asked RMG to prepare an interview template.",
  Template_Ready: "RMG prepared the template — TA can now schedule the AI interview.",
  Prepared: "The AI interview is set up for the candidate.",
};

/** Admin overrides (`uitext.*` app settings), loaded once by CrmApp.
 * Module-level on purpose: statusHelp() is called from render paths that
 * have no hook context, and the copy arriving a beat after first paint is
 * fine — the built-in text is already correct, just not customised. */
let _uiText: Record<string, string> = {};

export function setUiTextOverrides(map: Record<string, string> | null | undefined) {
  _uiText = map || {};
}

export function uiTextOverride(key: string): string | undefined {
  const v = _uiText[key];
  return v && v.trim() ? v : undefined;
}

export function statusHelp(status: string | null | undefined): string | undefined {
  if (!status) return undefined;
  return uiTextOverride(`uitext.status.${status}`) || STATUS_HELP[status] || undefined;
}
