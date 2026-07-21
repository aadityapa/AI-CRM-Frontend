/**
 * ONE schema-driven renderer for the Opportunity form (Part 3). It renders any
 * section/field from `opportunitySchema` — there is no per-type form component.
 */
import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Plus } from "lucide-react";
import { Field, inputCls } from "../../components/ui";
import {
  fieldVisible,
  sectionVisible,
  type FieldDef,
  type OpportunityType,
  type SectionDef,
} from "./opportunitySchema";

export type OptionList = { value: string; label: string }[];
export type OptionsMap = Record<string, OptionList>;

export interface FieldRenderProps {
  section: SectionDef;
  type: OpportunityType | "";
  values: Record<string, unknown>;
  details: Record<string, unknown>;
  errors: Record<string, string>;
  options: OptionsMap;
  disabledReason: (f: FieldDef) => string | null;
  nextFieldKey?: string;
  strictSequential?: boolean;
  flashKeys?: string[];
  onChange: (f: FieldDef, value: unknown) => void;
  onBlur: (f: FieldDef) => void;
  registerRef?: (key: string, el: HTMLElement | null) => void;
  onAddNew?: (kind: NonNullable<FieldDef["addNew"]>, f: FieldDef) => void;
}

const badge =
  "ml-2 rounded-full bg-surface-2 px-1.5 py-0.5 text-xs font-semibold text-muted align-middle";

/* Error state composes the token .input-error recipe on the flat input
 * (danger border at rest/hover, danger focus ring) — see styles/tokens.css. */
const inputErrCls = "input-error";

const SELECT_PLACEHOLDER = "— Select —";

const CORE_FIELD_KEYS = new Set([
  "customer_id", "branch_id", "contact_person_id", "hiring_manager_id",
  "title", "rfi_received_date", "opp_type", "rfi_value",
  "onboarded_count", "onboarding_status",
]);

function optionsFor(f: FieldDef, options: OptionsMap): OptionList {
  if (f.options) return f.options;
  if (f.optionsSource && options[f.optionsSource]) return options[f.optionsSource];
  return [];
}

function formatDisplayDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-");
}

/** Filterable combobox for `searchable: true` select fields. */
function SearchableSelect({
  id,
  value,
  options,
  disabled,
  err,
  describedBy,
  placeholder,
  onChange,
  onBlur,
  registerRef,
  className,
}: {
  id: string;
  value: string;
  options: OptionList;
  disabled?: boolean;
  err?: string;
  describedBy?: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  registerRef?: (el: HTMLElement | null) => void;
  className: string;
}) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const listId = `${id}-listbox`;
  const selected = options.find((o) => o.value === value);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [highlight, setHighlight] = React.useState(0);

  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open, value]);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  React.useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery("");
  };

  const display = open ? query : (selected?.label || "");

  return (
    <div
      ref={rootRef}
      className="relative"
    >
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-required={undefined}
        aria-invalid={!!err || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        className={className}
        placeholder={placeholder || SELECT_PLACEHOLDER}
        value={display}
        autoComplete="off"
        ref={(el) => registerRef?.(el)}
        onFocus={() => { if (!disabled) setOpen(true); }}
        onBlur={onBlur}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            const hit = filtered[highlight];
            if (hit) pick(hit.value);
          } else if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
          }
        }}
      />
      {open && !disabled && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-control border border-subtle bg-surface-1 py-1 shadow-raised"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">No matches</li>
          ) : filtered.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`cursor-pointer px-3 py-2 text-sm ${
                i === highlight ? "bg-surface-2 text-primary" : "text-secondary hover:bg-surface-2"
              }`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o.value);
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FieldControl({
  f,
  values,
  details,
  errors,
  options,
  disabledReason,
  nextFieldKey,
  strictSequential,
  flashKeys,
  onChange,
  onBlur,
  registerRef,
  onAddNew,
}: { f: FieldDef } & FieldRenderProps) {
  const reduce = useReducedMotion();
  const isFlash = !!flashKeys?.includes(f.key);
  const isCore = CORE_FIELD_KEYS.has(f.key);
  const raw = isCore ? values[f.key] : details[f.key];
  const value = raw ?? f.default ?? (f.type === "checkbox" ? false : "");
  const reason = disabledReason(f);
  const disabled = !!reason;
  const err = errors[f.key];
  const strValue = f.type === "checkbox" ? "" : String(value ?? "").trim();
  const showAutoBadge = !!f.autoFilledFrom && strValue !== "";
  const describedBy = err ? `${f.key}-err` : reason ? `${f.key}-hint` : f.helperText ? `${f.key}-help` : undefined;
  const isNext = nextFieldKey === f.key;

  const common = {
    id: f.key,
    "aria-required": f.required || undefined,
    "aria-invalid": !!err || undefined,
    "aria-describedby": describedBy,
    disabled: disabled || (strictSequential && isNext === false && !value ? false : false),
    onBlur: () => onBlur(f),
    ref: (el: HTMLElement | null) => registerRef?.(f.key, el),
    className: `${inputCls} ${err ? inputErrCls : ""} ${
      disabled ? "opacity-50 cursor-not-allowed" : ""
    }`,
  } as const;

  let control: React.ReactNode;
  switch (f.type) {
    case "select":
      if (f.searchable) {
        control = (
          <SearchableSelect
            id={f.key}
            value={String(value ?? "")}
            options={optionsFor(f, options)}
            disabled={disabled}
            err={err}
            describedBy={describedBy}
            placeholder={f.placeholder || SELECT_PLACEHOLDER}
            className={common.className}
            registerRef={(el) => registerRef?.(f.key, el)}
            onBlur={() => onBlur(f)}
            onChange={(v) => onChange(f, v)}
          />
        );
      } else {
        control = (
          <select {...common} value={String(value ?? "")} onChange={(e) => onChange(f, e.target.value)}>
            <option value="">{SELECT_PLACEHOLDER}</option>
            {optionsFor(f, options).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        );
      }
      break;
    case "textarea":
    case "richtext":
      control = (
        <textarea {...common} rows={f.type === "richtext" ? 6 : 3} value={String(value ?? "")}
          placeholder={f.placeholder} onChange={(e) => onChange(f, e.target.value)} />
      );
      break;
    case "checkbox":
      control = (
        <label className="flex items-center gap-2 text-sm text-secondary">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!!value} disabled={disabled}
            id={f.key} onChange={(e) => onChange(f, e.target.checked)}
            ref={(el) => registerRef?.(f.key, el)} />
          {f.label}
        </label>
      );
      break;
    case "readonly":
      control = (
        <input {...common} readOnly value={String(value ?? "")} placeholder={f.helperText || "Auto-generated on save"}
          className={`${inputCls} bg-surface-2 opacity-80`} />
      );
      break;
    case "date":
      control = (
        <div>
          <input {...common} type="date" value={String(value ?? "")}
            onChange={(e) => onChange(f, e.target.value)} />
          {String(value ?? "") && (
            <p className="mt-1 text-xs text-muted">{formatDisplayDate(String(value))}</p>
          )}
        </div>
      );
      break;
    case "file": {
      const names = Array.isArray(value)
        ? (value as string[]).join(", ")
        : String(value ?? "");
      control = (
        <div>
          <input
            id={f.key}
            type="file"
            multiple={!!f.multiple}
            accept={f.accept}
            disabled={disabled}
            aria-invalid={!!err}
            aria-describedby={describedBy}
            className={`${inputCls} file:mr-3 file:rounded-control file:border-0 file:bg-brand-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-brand-700`}
            ref={(el) => registerRef?.(f.key, el)}
            onBlur={() => onBlur(f)}
            onChange={(e) => {
              const list = Array.from(e.target.files || []);
              onChange(f, list);
            }}
          />
          {names ? (
            <p className="mt-1 text-xs text-secondary">Selected: {names}</p>
          ) : null}
        </div>
      );
      break;
    }
    default: {
      const inputType = f.type === "number" || f.type === "currency" || f.type === "percent" ? "number"
        : f.type === "email" ? "email"
        : f.type === "tel" ? "tel"
        : "text";
      control = (
        <input {...common} type={inputType} value={String(value ?? "")} placeholder={f.placeholder}
          step={f.type === "currency" ? "0.01" : undefined}
          min={f.min} max={f.max}
          onChange={(e) => onChange(f, e.target.value)} />
      );
    }
  }

  const wrapped = (
    <div>
      {f.addNew && onAddNew ? (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">{control}</div>
          <button
            type="button"
            aria-label={`Add new ${f.addNew}`}
            title={`Add new ${f.addNew}`}
            onClick={() => onAddNew(f.addNew!, f)}
            className="shrink-0 rounded-control border border-subtle bg-brand-600 p-2 text-white transition-colors hover:bg-brand-500"
          >
            <Plus size={16} />
          </button>
        </div>
      ) : control}
      {showAutoBadge && <span className={badge}>auto-filled</span>}
      {f.helperText && f.type !== "readonly" && (
        <p id={`${f.key}-help`} className="mt-1 text-xs text-muted">{f.helperText}</p>
      )}
      {reason && <p id={`${f.key}-hint`} className="mt-1 text-xs text-muted">{reason}</p>}
      {err && (
        <motion.p id={`${f.key}-err`} role="alert" className="mt-1 text-xs text-danger"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }}>
          {err}
        </motion.p>
      )}
    </div>
  );

  if (f.type === "checkbox") return <div className="pt-6">{wrapped}</div>;

  const stateRing = isFlash
    ? "shadow-focus-ring"
    : isNext && !reduce
      ? "ring-1 ring-strong"
      : "";

  return (
    <div className={`rounded-control transition-shadow duration-micro ease-smooth ${stateRing}`}>
      <Field label={f.label} required={f.required} error={undefined}>{wrapped}</Field>
    </div>
  );
}

/** Renders one section's field grid (kind: "fields"). Tables/attachments render elsewhere. */
export function SectionFields(props: FieldRenderProps) {
  const { section, type } = props;
  const fields = (section.fields || []).filter((f) => fieldVisible(section, f, type));
  if (!fields.length) {
    if (section.fieldsVisibleFor && type && !section.fieldsVisibleFor.includes(type)) {
      return <p className="text-sm italic text-muted">Not applicable for this opportunity type.</p>;
    }
    return null;
  }
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      {fields.map((f) => (
        <div
          key={f.key}
          className={
            f.colSpan === 2 || f.type === "textarea" || f.type === "richtext"
              ? "sm:col-span-2"
              : ""
          }
        >
          <FieldControl f={f} {...props} />
        </div>
      ))}
    </div>
  );
}

export { sectionVisible };
