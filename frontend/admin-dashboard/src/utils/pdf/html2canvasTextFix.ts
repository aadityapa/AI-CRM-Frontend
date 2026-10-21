/**
 * Text sat too low in every html2canvas PDF (22 Oct 2026, user screenshot:
 * "Buyer Details" touching the bottom of its navy bar).
 *
 * html2canvas 1.4.1 measures each font's baseline in the LIVE document: it
 * appends a hidden <div> to <body> holding a sample text <span> and a 1×1
 * <img>, and reads `img.offsetTop`. Tailwind's preflight makes every <img>
 * `display: block`, so the probe image drops to the next line, the measured
 * baseline is a full line too low, and every line of text in the capture is
 * drawn that much lower than on screen.
 *
 * The fix restores `display: inline` for exactly that probe image (a direct
 * child of a <div> on <body>, width/height 1, no class) while the capture
 * runs, then removes the rule. Nothing on the page is affected.
 */
const STYLE_ID = "kx-html2canvas-text-fix";
const RULE = 'body > div > img[width="1"][height="1"]:not([class]) { display: inline !important; }';

export async function withHtml2CanvasTextFix<T>(run: () => Promise<T>): Promise<T> {
  let added: HTMLStyleElement | null = null;
  if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
    added = document.createElement("style");
    added.id = STYLE_ID;
    added.textContent = RULE;
    document.head.appendChild(added);
  }
  try {
    return await run();
  } finally {
    added?.remove();
  }
}
