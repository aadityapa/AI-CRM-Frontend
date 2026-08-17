/**
 * Shared geo + contact-role option lists for CRM searchable dropdowns.
 * Values are plain strings (no FK masters).
 */

/** 28 Indian states + 8 union territories. */
export const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
] as const;

/** Major Indian cities (extends former WORK_LOCATION city set). */
export const INDIAN_CITIES = [
  "Bangalore",
  "Mumbai",
  "Pune",
  "Delhi",
  "Gurgaon",
  "Noida",
  "Hyderabad",
  "Chennai",
  "Kolkata",
  "Ahmedabad",
  "Jaipur",
  "Chandigarh",
  "Kochi",
  "Coimbatore",
  "Indore",
  "Nagpur",
  "Thiruvananthapuram",
  "Mysore",
  "Visakhapatnam",
  "Bhubaneswar",
  "Lucknow",
  "Vadodara",
  "Nashik",
  "Surat",
  "Patna",
  "Raipur",
  "Bhopal",
  "Guwahati",
  "Ranchi",
  "Dehradun",
  "Amritsar",
  "Ludhiana",
  "Faridabad",
  "Ghaziabad",
  "Kanpur",
  "Agra",
  "Vijayawada",
  "Madurai",
  "Tiruchirappalli",
  "Mangalore",
] as const;

/**
 * City → state, for the address forms' autofill. Picking a city answers the
 * state question — asking the user to answer it again invites mismatches
 * (Bangalore/Kerala, Pune/Gujarat) that end up on GST invoices.
 */
export const CITY_STATE: Record<string, string> = {
  Bangalore: "Karnataka",
  Mumbai: "Maharashtra",
  Pune: "Maharashtra",
  Delhi: "Delhi",
  Gurgaon: "Haryana",
  Noida: "Uttar Pradesh",
  Hyderabad: "Telangana",
  Chennai: "Tamil Nadu",
  Kolkata: "West Bengal",
  Ahmedabad: "Gujarat",
  Jaipur: "Rajasthan",
  Chandigarh: "Chandigarh",
  Kochi: "Kerala",
  Coimbatore: "Tamil Nadu",
  Indore: "Madhya Pradesh",
  Nagpur: "Maharashtra",
  Thiruvananthapuram: "Kerala",
  Mysore: "Karnataka",
  Visakhapatnam: "Andhra Pradesh",
  Bhubaneswar: "Odisha",
  Lucknow: "Uttar Pradesh",
  Vadodara: "Gujarat",
  Nashik: "Maharashtra",
  Surat: "Gujarat",
  Patna: "Bihar",
  Raipur: "Chhattisgarh",
  Bhopal: "Madhya Pradesh",
  Guwahati: "Assam",
  Ranchi: "Jharkhand",
  Dehradun: "Uttarakhand",
  Amritsar: "Punjab",
  Ludhiana: "Punjab",
  Faridabad: "Haryana",
  Ghaziabad: "Uttar Pradesh",
  Kanpur: "Uttar Pradesh",
  Agra: "Uttar Pradesh",
  Vijayawada: "Andhra Pradesh",
  Madurai: "Tamil Nadu",
  Tiruchirappalli: "Tamil Nadu",
  Mangalore: "Karnataka",
};

/** State for a known city; empty string for free-typed cities we don't know. */
export function stateForCity(city: string): string {
  return CITY_STATE[(city || "").trim()] || "";
}

/** Country list — India is the default for new address forms. */
export const COUNTRIES = [
  "India",
  "United States",
  "United Kingdom",
  "Germany",
  "Singapore",
  "United Arab Emirates",
  "Canada",
  "Australia",
  "Other",
] as const;

export const DEFAULT_COUNTRY = "India";

/** Branch / customer contact role options. */
export const CONTACT_ROLES = [
  "Finance",
  "Operational",
  "Procurement",
  "HR",
  "PMO",
] as const;

export type ContactRole = (typeof CONTACT_ROLES)[number];
