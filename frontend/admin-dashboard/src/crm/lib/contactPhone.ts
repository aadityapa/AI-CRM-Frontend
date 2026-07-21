/** Autofill helpers for CRM contact persons / hiring managers on the
 * Opportunity form. Selecting a person fills their email + phone (ids are set on core). */

export type ContactLike = {
  id?: number | string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  is_hiring_manager?: boolean;
};

export function emailFromContact(contact: ContactLike | null | undefined): string {
  return (contact?.email || "").trim();
}

export function phoneFromContact(contact: ContactLike | null | undefined): string {
  return (contact?.phone || "").trim();
}

/**
 * Hiring managers may also be the point of contact, so every active contact is
 * eligible as Contact Person; HM list is limited to is_hiring_manager.
 */
export function splitBranchContacts(branchContacts: ContactLike[]) {
  return {
    contactPersons: branchContacts,
    hiringManagers: branchContacts.filter((c) => c.is_hiring_manager),
  };
}

export type BranchContactFill = {
  contact_person_id: string;
  hiring_manager_id: string;
  contact_email: string;
  contact_phone: string;
  hiring_manager_email: string;
  hiring_manager_contact: string;
};

/**
 * Auto-pick sole contact / sole hiring manager for a branch, and fill
 * email + phone for whatever ids are selected (current or auto-picked).
 */
export function branchContactAutofill(
  branchContacts: ContactLike[],
  current?: Partial<Pick<BranchContactFill, "contact_person_id" | "hiring_manager_id">>,
): BranchContactFill {
  const { contactPersons, hiringManagers } = splitBranchContacts(branchContacts);

  const cpId = String(current?.contact_person_id || "");
  const hmId = String(current?.hiring_manager_id || "");

  const cp =
    (cpId ? contactPersons.find((c) => String(c.id) === cpId) : undefined)
    || (contactPersons.length === 1 ? contactPersons[0] : undefined);

  const hm =
    (hmId ? hiringManagers.find((c) => String(c.id) === hmId) : undefined)
    || (hiringManagers.length === 1 ? hiringManagers[0] : undefined);

  return {
    contact_person_id: cp ? String(cp.id) : cpId,
    hiring_manager_id: hm ? String(hm.id) : hmId,
    contact_email: emailFromContact(cp),
    contact_phone: phoneFromContact(cp),
    hiring_manager_email: emailFromContact(hm),
    hiring_manager_contact: phoneFromContact(hm),
  };
}
