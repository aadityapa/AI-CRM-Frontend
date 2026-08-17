/**
 * Teaching empty states — the copy that turns "No records found" into a
 * 20-second lesson about what the page is for and how the workflow moves.
 *
 * Why here and not inline in each page: new users meet these screens in their
 * FIRST week, when every list is empty. That makes the empty state the single
 * highest-traffic teaching surface in the app — and copy that lives in one
 * file gets reviewed and improved; copy scattered over 39 pages rots.
 *
 * Usage:  emptyMessage={<TeachingEmpty page="opportunities" />}
 * The component renders only the lesson; pages keep their own "no results
 * match your filters" strings for FILTERED empties — a filtered empty means
 * "adjust the filter", not "learn the concept".
 */
import React from "react";
import { uiTextOverride } from "../lib/statusHelp";

export const LESSONS: Record<string, { title: string; body: string; flow?: string }> = {
  customers: {
    title: "No customers yet",
    body: "A customer is a company you do business with. Branches, contacts, billing policy and documents all live under the customer.",
    flow: "Create customer → add branches & contacts → opportunities and POs attach to it",
  },
  opportunities: {
    title: "No opportunities yet",
    body: "An opportunity is a deal you are pursuing with a customer. When the Sales Head approves it, a Requirement is created automatically so hiring can start.",
    flow: "Create → Sales Head approves → Requirement appears for RMG",
  },
  requirements: {
    title: "No requirements yet",
    body: "A requirement is an open position to fill. Most are created automatically when an opportunity is approved. RMG attaches a JD and approves; then TA sources candidates.",
    flow: "Opportunity approved → RMG adds JD → TA sources → candidates flow in",
  },
  candidates: {
    title: "No candidates yet",
    body: "The candidate master holds every person you have ever engaged — their CV, experience, CTC and outreach history. Apply a candidate to a requirement to start a pipeline.",
    flow: "Add candidate (or import) → apply to a requirement → track in Candidate Profiles",
  },
  profiles: {
    title: "No candidate profiles yet",
    body: "A profile is one candidate being considered for one opportunity, moving stage by stage — sourcing, screening, customer interviews, offer, joining. Each stage has an owner; hover any status badge to see who acts next.",
    flow: "TA sources → RMG reviews → Sales screens → customer interviews → offer → joined",
  },
  projects: {
    title: "No projects yet",
    body: "A project is delivery work for a customer. Employees are mapped to it, timesheets are filed against it, and invoices are raised from those timesheets.",
    flow: "Create project → map employees → timesheets → invoices",
  },
  "project-employees": {
    title: "No project employees yet",
    body: "Mapping an employee to a project sets their billing rate, leave policy and timesheet duty. One employee can be mapped to several projects.",
    flow: "Map employee → rates & leave seed from the branch policy → timesheets become due monthly",
  },
  timesheets: {
    title: "No timesheets yet",
    body: "Every mapped employee owes one timesheet per month. Draft means not yet submitted; Submitted means waiting for RMG or Sales to approve; Approved sheets can be invoiced.",
    flow: "Employee fills & submits → RMG/Sales approves → Finance generates the invoice",
  },
  pos: {
    title: "No purchase orders yet",
    body: "A PO is the customer's commitment to spend. Invoices draw the PO balance down, and you will be warned before it expires. The PO number always comes from the customer.",
    flow: "Record PO → allocate to projects → invoices consume it → renew before expiry",
  },
  invoices: {
    title: "No invoices yet",
    body: "Invoices are generated from approved timesheets and always draw down a PO. Record payments and TDS against them here.",
    flow: "Approved timesheet → generate invoice → record payment / TDS",
  },
  "leave-applications": {
    title: "No leave applications yet",
    body: "Employees apply for leave here; HR approves or rejects. Balances come from the customer or project leave policy and are credited monthly by the system.",
    flow: "Employee applies → HR decides → balance updates automatically",
  },
  holidays: {
    title: "No holidays yet",
    body: "Holidays entered here pre-mark timesheet days and drive holiday billing. They can be customer- or branch-specific.",
  },
  employees: {
    title: "No employees yet",
    body: "The employee master is the HR record — personal details, CTC, bank details, education, leave balances. Map employees to projects from the Projects page.",
  },
  "template-requests": {
    title: "No template requests yet",
    body: "When TA needs an AI interview for a candidate, they raise a request here; RMG prepares the interview template, and TA then schedules the interview.",
    flow: "TA requests → RMG prepares template → TA schedules the AI interview",
  },
};

export function TeachingEmpty({ page, cta }: { page: string; cta?: React.ReactNode }) {
  const lesson = LESSONS[page];
  if (!lesson) return <>No records found</>;
  // Admins can rewrite the body from Settings → UI Text (uitext.empty.<page>).
  const body = uiTextOverride(`uitext.empty.${page}`) || lesson.body;
  return (
    <span className="block space-y-2 text-left sm:text-center">
      <span className="block text-sm font-semibold text-primary">{lesson.title}</span>
      <span className="block text-sm text-secondary">{body}</span>
      {lesson.flow && (
        <span className="block text-xs text-muted">{lesson.flow}</span>
      )}
      {cta && <span className="block pt-1">{cta}</span>}
    </span>
  );
}
