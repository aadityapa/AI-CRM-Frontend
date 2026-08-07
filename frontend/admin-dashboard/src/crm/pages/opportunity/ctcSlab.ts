/** Pure Candidate CTC Slab calculations shared by every form trigger. */

export type BillingType = "Per Hour" | "Per Day" | "Per Month" | "Per Year";

export type CtcSlabRow = Record<string, unknown> & {
  exp_min?: unknown;
  exp_max?: unknown;
  target_exp?: unknown;
  rate?: unknown;
  revenue_monthly?: unknown;
  revenue_annual?: unknown;
  management_cost_pct?: unknown;
  engineering_budget?: unknown;
  hike_pct?: unknown;
  appraisal_cycle?: unknown;
  approved_ctc_lac?: unknown;
};

export type BillingInputs = {
  opportunityType?: unknown;
  billingType?: unknown;
  projectDurationMonths?: unknown;
  hoursPerDay?: unknown;
  holidays?: unknown;
  weekoff?: unknown;
  leave?: unknown;
  holidaysBillable?: unknown;
  weekoffBillable?: unknown;
  leaveBillable?: unknown;
  /** Contractual cap from branch Billing Properties (Max Billable Hours / Month).
   *  Annual billing hours never exceed cap × 12. Blank/0 = no cap. */
  maxBillableHoursMonth?: unknown;
};

export type BillingBases = {
  actualBillingDays: number;
  actualBillingHours: number | "";
};

function finiteOrNull(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function zeroWhenBlank(value: unknown): number {
  return finiteOrNull(value) ?? 0;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isTrue(value: unknown): boolean {
  return value === true || value === 1 || String(value).toLowerCase() === "true";
}

/**
 * Billable leave/holiday/weekoff values remain chargeable and are not deducted.
 * Blank values count as zero; hours remain blank until Hours Per Day is supplied.
 */
export function calculateBillingBases(inputs: BillingInputs): BillingBases {
  const deductions =
    (isTrue(inputs.weekoffBillable) ? 0 : zeroWhenBlank(inputs.weekoff)) +
    (isTrue(inputs.holidaysBillable) ? 0 : zeroWhenBlank(inputs.holidays)) +
    (isTrue(inputs.leaveBillable) ? 0 : zeroWhenBlank(inputs.leave));
  const actualBillingDays = roundMoney(Math.max(0, 365 - deductions));
  const hoursPerDay = finiteOrNull(inputs.hoursPerDay);
  let actualBillingHours: number | "" =
    hoursPerDay === null ? "" : roundMoney(actualBillingDays * Math.max(0, hoursPerDay));
  // Branch Billing Properties → Max Billable Hours / Month is the CONTRACTUAL
  // hours basis: when set, it replaces the calendar derivation entirely —
  // Monthly Revenue = rate × cap, Annual = monthly × 12 (cap × 12 hours/year).
  const capMonthly = finiteOrNull(inputs.maxBillableHoursMonth);
  if (capMonthly !== null && capMonthly > 0) {
    actualBillingHours = roundMoney(capMonthly * 12);
  }
  return { actualBillingDays, actualBillingHours };
}

/**
 * Recalculate the complete revenue chain. Derived outputs are blank when the
 * selected billing type lacks a required source value; a numeric zero is valid.
 */
export function calculateCtcSlabRow(
  row: CtcSlabRow,
  inputs: BillingInputs,
): CtcSlabRow {
  const bases = calculateBillingBases(inputs);
  // Exp Max is derived: midpoint of Exp Min and Target Exp (legacy parity).
  const expMin = finiteOrNull(row.exp_min);
  const targetExp = finiteOrNull(row.target_exp);
  const expMax = expMin !== null && targetExp !== null ? roundMoney((expMin + targetExp) / 2) : "";
  row = { ...row, exp_max: expMax };
  const rate = finiteOrNull(row.rate);
  const managementCostPct = zeroWhenBlank(row.management_cost_pct);
  const hikePct = zeroWhenBlank(row.hike_pct);
  const opportunityType = String(inputs.opportunityType || "");
  const billingType = String(inputs.billingType || "") as BillingType | "";

  let annual: number | null = null;
  if (rate !== null) {
    switch (opportunityType) {
      case "T&M":
        switch (billingType) {
          case "Per Hour":
            if (bases.actualBillingHours !== "") annual = rate * bases.actualBillingHours;
            break;
          case "Per Day":
            annual = rate * bases.actualBillingDays;
            break;
          case "Per Month":
            annual = rate * 12;
            break;
          case "Per Year":
            annual = rate;
            break;
          default:
            annual = null;
        }
        break;
      case "Work_Package":
        annual = rate;
        break;
      case "Fixed_Price": {
        const duration = finiteOrNull(inputs.projectDurationMonths);
        // A blank duration means the entered total is already annual; zero is invalid.
        annual = duration === null ? rate : duration > 0 ? rate / (duration / 12) : null;
        break;
      }
      case "Retainer":
        annual = rate * 12;
        break;
      default:
        annual = null;
    }
  }

  if (annual === null || !Number.isFinite(annual)) {
    return {
      ...row,
      revenue_monthly: "",
      revenue_annual: "",
      engineering_budget: "",
      approved_ctc_lac: "",
    };
  }

  const annualRounded = roundMoney(annual);
  const monthly = roundMoney(annual / 12);
  const engineeringBudget = roundMoney(annual * (1 - managementCostPct / 100));
  const approvedDenominator = 1 + hikePct / 100;
  const approvedCTC =
    approvedDenominator > 0 ? roundMoney(engineeringBudget / approvedDenominator) : "";

  return {
    ...row,
    revenue_monthly: monthly,
    revenue_annual: annualRounded,
    engineering_budget: engineeringBudget,
    approved_ctc_lac: approvedCTC,
  };
}

export function recalculateCtcSlab(
  rows: CtcSlabRow[],
  inputs: BillingInputs,
): CtcSlabRow[] {
  return (rows || []).map((row) => calculateCtcSlabRow(row, inputs));
}

/** True when a form value is present and parseable as a finite number. */
export function hasNumericInput(value: unknown): boolean {
  return finiteOrNull(value) !== null;
}

/**
 * Period for RFI: prefer tm_duration_months; for Fixed_Price fall back to
 * project_duration_months when T&M duration is absent.
 */
export function resolveRfiPeriodMonths(
  opportunityType: unknown,
  details: Record<string, unknown>,
): unknown {
  if (hasNumericInput(details.tm_duration_months)) return details.tm_duration_months;
  if (String(opportunityType || "") === "Fixed_Price") {
    return details.project_duration_months;
  }
  return details.tm_duration_months;
}

/**
 * RFI Value = Annual Revenue × (Period / 12) × Position Count.
 * Returns null when any of the three inputs is missing (caller keeps manual edit).
 * Otherwise returns the raw product (no money rounding).
 */
export function calculateRfiValue(opts: {
  revenueAnnual: unknown;
  periodMonths: unknown;
  positionsCount: unknown;
}): number | null {
  if (
    !hasNumericInput(opts.revenueAnnual)
    || !hasNumericInput(opts.periodMonths)
    || !hasNumericInput(opts.positionsCount)
  ) {
    return null;
  }
  const annual = zeroWhenBlank(opts.revenueAnnual);
  const period = zeroWhenBlank(opts.periodMonths);
  const positions = zeroWhenBlank(opts.positionsCount);
  return annual * (period / 12) * positions;
}

export function validateCtcExperience(row: CtcSlabRow): string {
  const min = finiteOrNull(row.exp_min);
  const max = finiteOrNull(row.exp_max);
  if (min !== null && max !== null && min > max) {
    return "Exp Min must be less than or equal to Exp Max";
  }
  return "";
}
