/** Customer Type codes — gated by whether the customer has any PO on record. */

export const CUSTOMER_TYPE_LABELS = {
  NN: "NN — New customer (no PO yet)",
  EN: "EN — Existing, new domain/branch",
  EE: "EE — Existing customer",
} as const;

export type CustomerTypeCode = keyof typeof CUSTOMER_TYPE_LABELS;

export function customerTypeOptionsForPo(hasPo: boolean): { value: CustomerTypeCode; label: string }[] {
  if (hasPo) {
    return [
      { value: "EN", label: CUSTOMER_TYPE_LABELS.EN },
      { value: "EE", label: CUSTOMER_TYPE_LABELS.EE },
    ];
  }
  return [{ value: "NN", label: CUSTOMER_TYPE_LABELS.NN }];
}

/** Resolve the effective type: NN when no PO; otherwise EN or EE (default EN). */
export function normalizeCustomerType(hasPo: boolean, value?: string | null): CustomerTypeCode {
  if (!hasPo) return "NN";
  if (value === "EE") return "EE";
  return "EN";
}
