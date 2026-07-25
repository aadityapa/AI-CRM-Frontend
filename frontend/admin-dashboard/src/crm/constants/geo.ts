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
] as const;

export type ContactRole = (typeof CONTACT_ROLES)[number];
