/**
 * Split phone control: searchable country picker + national number.
 *
 * Why a picker at all (1 Sep 2026, user request): candidates are sourced from
 * several countries and typing "+971" from memory is both slow and easy to get
 * wrong. Typing "United" or "971" here narrows the list instantly.
 *
 * The value in and out is still ONE string — E.164 when it parses — so every
 * caller, payload and column keeps working unchanged.
 */
import React from "react";
import { SearchableSelect } from "./SearchableSelect";
import { inputCls } from "./ui";
import { countryOptions, formatE164, parsePhone } from "../lib/phone";

const DEFAULT_DIAL = "+91";

export function PhoneField({
  value,
  onChange,
  disabled,
  placeholder = "Phone number",
  id,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
}) {
  const options = React.useMemo(
    () => countryOptions().map((c) => ({
      // The dial code IS the value — two countries can share one (+1), and the
      // number is all we persist, so picking either is the same answer.
      value: c.dial,
      label: `${c.name} (${c.dial})`,
    })),
    [],
  );
  // De-duplicate by dial code: SearchableSelect matches on value, and a repeat
  // would make the committed label flip between countries on re-render.
  const dialOptions = React.useMemo(() => {
    const seen = new Set<string>();
    return options.filter((o) => (seen.has(o.value) ? false : (seen.add(o.value), true)));
  }, [options]);

  const parsed = parsePhone(value);
  // The typed digits live in local state so a half-entered number is never
  // reformatted (or dropped) under the cursor; the parent still gets every
  // keystroke as a normalised value.
  const [national, setNational] = React.useState(parsed?.national || "");
  const [dial, setDial] = React.useState(parsed?.countryCode || DEFAULT_DIAL);

  // Re-sync when the parent replaces the value wholesale (resume autofill,
  // opening the form on another record) — not on our own edits.
  const lastEmitted = React.useRef(value);
  React.useEffect(() => {
    if (value === lastEmitted.current) return;
    const p = parsePhone(value);
    setNational(p?.national || "");
    setDial(p?.countryCode || DEFAULT_DIAL);
    lastEmitted.current = value;
  }, [value]);

  const emit = (nextDial: string, nextNational: string) => {
    const digits = nextNational.replace(/\D/g, "");
    const next = digits ? formatE164(nextDial, digits) : "";
    lastEmitted.current = next;
    onChange(next);
  };

  return (
    <div className="flex items-stretch gap-2">
      <div className="w-[10.5rem] shrink-0">
        <SearchableSelect
          id={id ? `${id}-country` : undefined}
          value={dial}
          options={dialOptions}
          disabled={disabled}
          placeholder="Country"
          onChange={(v) => { setDial(v || DEFAULT_DIAL); emit(v || DEFAULT_DIAL, national); }}
        />
      </div>
      <input
        id={id}
        className={inputCls}
        type="tel"
        inputMode="tel"
        disabled={disabled}
        placeholder={placeholder}
        value={national}
        onChange={(e) => {
          // Digits only — the country code is the picker's job, so a pasted
          // "+91 98765 43210" must not end up as "+91+919876543210".
          const pastedDial = parsePhone(e.target.value);
          if (pastedDial && /^\s*\+/.test(e.target.value)) {
            setDial(pastedDial.countryCode);
            setNational(pastedDial.national);
            emit(pastedDial.countryCode, pastedDial.national);
            return;
          }
          const digits = e.target.value.replace(/\D/g, "");
          setNational(digits);
          emit(dial, digits);
        }}
      />
    </div>
  );
}
