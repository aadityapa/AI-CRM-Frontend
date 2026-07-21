const { parsePhoneNumberFromString } = require("libphonenumber-js");

function parsePhone(raw, defaultCountry = "IN") {
  const s = String(raw ?? "").trim();
  if (!s || /^\+\d{1,4}$/.test(s)) return null;
  const pn = parsePhoneNumberFromString(s, defaultCountry);
  if (!pn || !(pn.isValid() || pn.isPossible())) return null;
  return {
    countryCode: `+${pn.countryCallingCode}`,
    national: String(pn.nationalNumber),
    e164: String(pn.number),
  };
}

function hasPhoneNumber(raw) {
  const s = String(raw ?? "").trim();
  return !!s && !/^\+\d{1,4}$/.test(s);
}

function formatPhoneDisplay(raw) {
  const s = String(raw ?? "").trim();
  if (!s || /^\+\d{1,4}$/.test(s)) return "";
  const parsed = parsePhone(s);
  return parsed ? `${parsed.countryCode} ${parsed.national}` : s;
}

function resolveContactPhone(contact) {
  if (!hasPhoneNumber(contact.phone)) return "";
  return formatPhoneDisplay(contact.phone);
}

const contacts = [
  { id: 3, name: "Pawan", email: "pavan@honda.com", phone: "16554887545", is_hiring_manager: false },
  { id: 4, name: "Pavan", email: "pavan@honda.com", phone: "1234567895", is_hiring_manager: true },
];

console.log("=== HOP 1: API phones ===");
console.log(JSON.stringify(contacts, null, 2));

console.log("\n=== HOP 2: autofill resolver ===");
for (const c of contacts) {
  console.log(c.name, "->", JSON.stringify(resolveContactPhone(c)));
}

function splitPhoneValue(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { code: "+91", number: "" };
  const parsed = parsePhone(s);
  if (parsed) return { code: parsed.countryCode, number: parsed.national };
  const m = s.match(/^(\+\d{1,4})[\s.-]+(.+)$/);
  if (m) return { code: m[1], number: m[2] };
  if (/^\+\d{1,4}$/.test(s)) return { code: s, number: "" };
  return { code: "+91", number: s };
}

console.log("\n=== HOP 3/4: phone component split ===");
for (const c of contacts) {
  const display = resolveContactPhone(c);
  console.log(c.name, "state value:", JSON.stringify(display), "render:", splitPhoneValue(display));
}
