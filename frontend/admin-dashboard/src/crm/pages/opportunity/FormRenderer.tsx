/**
 * ONE schema-driven renderer for the Opportunity form (Part 3). It renders any
 * section/field from `opportunitySchema` — there is no per-type form component.
 */
import { Check, Lock, Plus, Building2, Mail, Phone, User, MapPin, Hash, Calendar, type LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import React from "react";
import { Field, inputCls } from "../../components/ui";
import { SearchableSelect } from "../../components/SearchableSelect";
import {
  InfoChip,
  AutoFilledBadge,
  guessFieldIcon,
  lockedInputCls as wizLockedCls,
  type FieldIconKind,
} from "../../components/wizard";
import {
  fieldVisible,
  fieldMatchesShowWhen,
  type FieldDef,
  type OpportunityType,
  type SectionDef,
} from "./opportunitySchema";

const FIELD_ICONS: Record<FieldIconKind, LucideIcon> = {
  building: Building2,
  mail: Mail,
  phone: Phone,
  user: User,
  map: MapPin,
  hash: Hash,
  calendar: Calendar,
  lock: Lock,
};

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
  /** Keys forced into readonly/auto style (e.g. RFI Value when formula inputs exist). */
  forceReadonlyKeys?: string[];
  onChange: (f: FieldDef, value: unknown) => void;
  onBlur: (f: FieldDef) => void;
  registerRef?: (key: string, el: HTMLElement | null) => void;
  onAddNew?: (kind: NonNullable<FieldDef["addNew"]>, f: FieldDef) => void;
  /** Compact grid (merged Commercials step) — tighter gaps, same fields. */
  dense?: boolean;
}


/* Error state composes the token .input-error recipe on the flat input
 * (danger border at rest/hover, danger focus ring) — see styles/tokens.css. */
const inputErrCls = "input-error";

/** Locked / read-only control look (auto-filled mirrors + committed searchable selects). */
const lockedInputCls = wizLockedCls;

const SELECT_PLACEHOLDER = "— Select —";

const CORE_FIELD_KEYS = new Set([
  "opp_id", "customer_id", "branch_id", "contact_person_id", "hiring_manager_id",
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
  forceReadonlyKeys,
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
  const forceReadonly = !!forceReadonlyKeys?.includes(f.key) || f.type === "readonly";
  const strValue = f.type === "checkbox" ? "" : String(value ?? "").trim();
  const showAutoBadge = (!!f.autoFilledFrom || (forceReadonlyKeys?.includes(f.key) && f.computed?.formula === "rfiValue"))
    && strValue !== "";
  const describedBy = err ? `${f.key}-err` : reason ? `${f.key}-hint` : f.helperText ? `${f.key}-help` : undefined;
  const isNext = nextFieldKey === f.key;
  const displayValue = (() => {
    if (!forceReadonlyKeys?.includes(f.key)) return value;
    if (f.type === "currency" || f.computed?.formula === "rfiValue") {
      const n = Number(value);
      return Number.isFinite(n) ? n.toFixed(2) : String(value ?? "");
    }
    return value;
  })();

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
  const lockedCls = `${lockedInputCls} ${err ? inputErrCls : ""} ${
    disabled ? "opacity-50 cursor-not-allowed" : ""
  }`;

  if (forceReadonlyKeys?.includes(f.key) && f.type !== "checkbox") {
    // Locked SELECTS must show the option's label, not its raw id — a hub-
    // locked Customer reads "HARMAN", never "12" (18 Aug 2026).
    const lockedDisplay = f.type === "select"
      ? (optionsFor(f, options).find((o) => String(o.value) === String(displayValue ?? ""))?.label
         ?? String(displayValue ?? ""))
      : String(displayValue ?? "");
    control = (
      <input
        {...common}
        readOnly
        value={lockedDisplay}
        placeholder={f.helperText || "Auto-calculated"}
        className={`${lockedInputCls} pl-9`}
      />
    );
  } else switch (f.type) {
    case "select":
      /* Auto-filled selects (e.g. Customer Type) are display-only — change via source dropdown. */
      if (f.autoFilledFrom) {
        const opts = optionsFor(f, options);
        const label = opts.find((o) => o.value === String(value ?? ""))?.label || String(value ?? "");
        control = (
          <input
            id={f.key}
            readOnly
            value={label}
            aria-required={f.required || undefined}
            aria-invalid={!!err || undefined}
            aria-describedby={describedBy}
            className={lockedCls}
            ref={(el) => registerRef?.(f.key, el)}
            onBlur={() => onBlur(f)}
            placeholder={SELECT_PLACEHOLDER}
          />
        );
      } else if (f.searchable) {
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
    case "multiselect": {
      /* Array of option values (18 Aug 2026): chips for chosen entries + a
       * select that appends. Legacy single-string values render as one chip,
       * so pre-multiselect opportunities keep working untouched. */
      const chosen: string[] = Array.isArray(value)
        ? value.map(String)
        : strValue ? [strValue] : [];
      const opts = optionsFor(f, options).filter((o) => !chosen.includes(String(o.value)));
      control = (
        <div>
          {chosen.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {chosen.map((c) => (
                <span key={c}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-0.5 text-xs font-semibold text-brand-600 dark:text-brand-300">
                  {c}
                  {!disabled && (
                    <button type="button" aria-label={`Remove ${c}`}
                      className="text-muted hover:text-danger"
                      onClick={() => onChange(f, chosen.filter((x) => x !== c))}>
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          <select {...common} value=""
            onChange={(e) => {
              if (e.target.value) onChange(f, [...chosen, e.target.value]);
            }}>
            <option value="">{chosen.length ? "+ Add another location…" : SELECT_PLACEHOLDER}</option>
            {opts.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      );
      break;
    }
    case "textarea":
    case "richtext":
      control = (
        <textarea {...common} rows={f.type === "richtext" ? 6 : 3} value={String(value ?? "")}
          placeholder={f.placeholder} onChange={(e) => onChange(f, e.target.value)}
          readOnly={!!f.autoFilledFrom} className={f.autoFilledFrom ? lockedCls : common.className} />
      );
      break;
    case "checkbox":
      control = (
        <label className={`flex items-center gap-2 text-sm text-secondary ${forceReadonly ? "cursor-default opacity-70" : ""}`}
          title={forceReadonly ? "Set by the branch billing policy — edit it on the customer's branch" : undefined}>
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!!value}
            disabled={disabled || forceReadonly}
            id={f.key} onChange={(e) => onChange(f, e.target.checked)}
            ref={(el) => registerRef?.(f.key, el)} />
          {f.label}
        </label>
      );
      break;
    case "readonly":
      control = (
        <input {...common} readOnly value={String(value ?? "")} placeholder={f.helperText || "Auto-generated on save"}
          className={`${lockedInputCls} pl-9`} />
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
      const autoLocked = !!f.autoFilledFrom;
      control = (
        <input
          {...common}
          type={inputType}
          value={String(value ?? "")}
          placeholder={f.placeholder}
          step={f.type === "currency" ? "0.01" : undefined}
          min={f.min}
          max={f.max}
          readOnly={autoLocked}
          className={autoLocked ? lockedCls : common.className}
          onChange={autoLocked ? undefined : (e) => onChange(f, e.target.value)}
        />
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
      {showAutoBadge && <AutoFilledBadge />}
      {f.helperText && (f.type !== "readonly" || forceReadonlyKeys?.includes(f.key)) && (
        <p id={`${f.key}-help`} className="mt-1 text-[11px] text-muted">{f.helperText}</p>
      )}
      {reason && (
        <InfoChip>
          <span id={`${f.key}-hint`}>{reason}</span>
        </InfoChip>
      )}
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

  const iconKind = forceReadonly ? undefined : guessFieldIcon(f.key, f.type);
  // Opportunity ID (readonly): lock on the right only — no leading icon.
  // Auto-filled emails/phones: green check (not lock), matching the target mockup.
  const showLock = forceReadonly;
  const isFilled = !showLock && !err && strValue !== "";
  const Lead = iconKind ? FIELD_ICONS[iconKind] : null;
  const needsPad = !!Lead;

  return (
    <div className={`rounded-control transition-shadow duration-micro ease-smooth ${stateRing}`}>
      <Field label={f.label} required={f.required} error={undefined}>
        <div className="relative">
          {Lead && needsPad && (
            <span className="pointer-events-none absolute left-3.5 top-1/2 z-[1] -translate-y-1/2 text-[color:var(--wiz-muted)]">
              <Lead size={15} aria-hidden />
            </span>
          )}
          <div
            className={
              needsPad
                ? "[&_input]:pl-10 [&_select]:pl-10 [&_textarea]:pl-10 [&_button.min-w-0]:pl-10"
                : undefined
            }
          >
            {wrapped}
          </div>
          {(showLock || isFilled) && !f.addNew && (
            <span className="pointer-events-none absolute right-3.5 top-1/2 z-[1] -translate-y-1/2">
              {showLock ? (
                <Lock size={14} className="text-[color:var(--wiz-muted)]" aria-hidden />
              ) : (
                <Check size={15} className="text-[color:var(--wiz-success,#22C55E)]" strokeWidth={2.5} aria-hidden />
              )}
            </span>
          )}
        </div>
      </Field>
    </div>
  );
}

/** Renders one section's field grid (kind: "fields"). Tables/attachments render elsewhere. */
export function SectionFields(props: FieldRenderProps) {
  const { section, type, values, details } = props;
  const fields = (section.fields || []).filter(
    (f) => fieldVisible(section, f, type) && fieldMatchesShowWhen(f, values, details),
  );
  if (!fields.length) {
    if (section.fieldsVisibleFor && type && !section.fieldsVisibleFor.includes(type)) {
      return <p className="text-sm italic text-muted">Not applicable for this opportunity type.</p>;
    }
    return null;
  }
  return (
    <div
      className={
        props.dense
          ? "grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2"
          : "grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2"
      }
    >
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

