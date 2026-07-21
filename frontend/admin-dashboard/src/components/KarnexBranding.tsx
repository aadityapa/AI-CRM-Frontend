/**
 * Unified Karnex branding — transparent SVG logo + product copy.
 * Served from /assets/karnex-logo.svg (light surfaces) and karnex-logo-light.svg (dark).
 */
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
  const logoH = isSm ? 28 : 36;
  const src =
    variant === "dark"
      ? "/assets/karnex-logo-light.svg"
      : variant === "light"
        ? "/assets/karnex-logo.svg"
        : "/assets/karnex-logo.svg";

  return (
    <div className={`flex flex-col gap-1 select-none ${className}`}>
      <div
        className="inline-flex items-center justify-center rounded-card border border-subtle bg-surface-1 px-3 py-2 shadow-raised"
        style={{ maxWidth: isSm ? 160 : 200 }}
      >
        <img
          src={src}
          alt="KARNEX — Enterprise AI Interview Platform"
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
      <div className="text-xs">
        <p className="m-0 font-bold uppercase tracking-widest text-muted">
          AI HR SUITE
        </p>
        {!isSm && (
          <p className="m-0 mt-0.5 text-xs font-medium text-muted">
            Enterprise AI Interview Platform
          </p>
        )}
      </div>
    </div>
  );
}
