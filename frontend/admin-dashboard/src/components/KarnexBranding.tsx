/**
 * Unified Karnex branding — transparent SVG logo + product copy.
 * Served from /assets/karnex-logo.svg (light surfaces) and karnex-logo-light.svg (dark).
 * The product name / tagline come from lib/brand.ts.
 */
import { APP_NAME, APP_NAME_UPPER } from "../lib/brand";

export function KarnexBranding({
  size = "md",
  className = "",
  variant = "auto",
}: {
  size?: "sm" | "md";
  className?: string;
  /** auto picks light logo on dark theme via CSS class */
  variant?: "auto" | "light" | "dark";
}) {
  const isSm = size === "sm";
  const logoH = isSm ? 30 : 36;
  const shellWidth = isSm ? 172 : 200;
  const shellPaddingX = isSm ? "0.5rem" : "0.75rem";
  const shellPaddingY = isSm ? "0.35rem" : "0.5rem";
  const src =
    variant === "dark"
      ? "/assets/karnex-logo-light.svg"
      : variant === "light"
        ? "/assets/karnex-logo.svg"
        : "/assets/karnex-logo.svg";

  return (
    <div className={`flex flex-col gap-0.5 select-none ${className}`}>
      <div
        className="inline-flex items-center justify-start rounded-card border border-subtle bg-surface-1 shadow-raised"
        style={{
          width: shellWidth,
          maxWidth: shellWidth,
          paddingLeft: shellPaddingX,
          paddingRight: shellPaddingX,
          paddingTop: shellPaddingY,
          paddingBottom: shellPaddingY,
        }}
      >
        <img
          src={src}
          alt={`KARNEX — ${APP_NAME}`}
          className="block max-w-full object-contain dark:hidden"
          style={{ height: logoH, width: "auto" }}
          draggable={false}
          decoding="async"
        />
        <img
          src="/assets/karnex-logo-light.svg"
          alt=""
          aria-hidden
          className="hidden max-w-full object-contain dark:block"
          style={{ height: logoH, width: "auto" }}
          draggable={false}
          decoding="async"
        />
      </div>
      <div className="pl-0.5 text-xs">
        <p className="m-0 font-bold uppercase tracking-[0.28em] text-muted">
          {APP_NAME_UPPER}
        </p>
      </div>
    </div>
  );
}
