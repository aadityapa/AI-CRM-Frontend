/**
 * Minimal allow-list HTML sanitiser for previewing converted .docx content.
 *
 * Why this exists: `mammoth.convertToHtml()` output was rendered straight into
 * `dangerouslySetInnerHTML`. Candidate CVs arrive through the *public* apply
 * form, so a crafted .docx could carry a `javascript:` link (or an inline event
 * handler, if a future mammoth style map emits one) that executes on the CRM
 * origin — where the auth token lives in localStorage.
 *
 * This is deliberately dependency-free and deliberately narrow: it parses into
 * a detached document, then keeps only the small element/attribute set mammoth
 * actually produces. Anything not on the list is unwrapped (children kept) or
 * dropped. It is not a general-purpose sanitiser — do not reuse it for
 * arbitrary third-party HTML.
 */

const ALLOWED_TAGS = new Set([
  "P", "BR", "HR", "DIV", "SPAN",
  "H1", "H2", "H3", "H4", "H5", "H6",
  "STRONG", "B", "EM", "I", "U", "S", "SUB", "SUP", "SMALL", "CODE", "PRE", "BLOCKQUOTE",
  "UL", "OL", "LI",
  "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH", "CAPTION", "COLGROUP", "COL",
  "A", "IMG",
]);

/** Tags whose entire subtree is removed, not unwrapped. */
const DROP_SUBTREE = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META",
  "FORM", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "SVG", "MATH", "TEMPLATE", "NOSCRIPT",
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(["href", "title"]),
  IMG: new Set(["src", "alt", "title", "width", "height"]),
  TD: new Set(["colspan", "rowspan"]),
  TH: new Set(["colspan", "rowspan", "scope"]),
  COL: new Set(["span"]),
  COLGROUP: new Set(["span"]),
};

/** Only these URL schemes may appear in href/src. Relative URLs are allowed. */
const SAFE_URL = /^(?:https?:|mailto:|tel:|#|\/(?!\/)|[^:/?#]*(?:[/?#]|$))/i;

function isSafeUrl(raw: string): boolean {
  // Strip control chars and whitespace first: "java\tscript:alert(1)" is a
  // valid URL to some parsers once they are removed.
  const value = raw.replace(/[\u0000-\u0020\u007f-\u00a0\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u3000\ufeff]/g, "");
  if (!value) return false;
  return SAFE_URL.test(value);
}

/** Data URLs are allowed for images only, and only for real image types. */
const SAFE_IMG_DATA_URL = /^data:image\/(?:png|jpeg|jpg|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i;

export function sanitizeHtml(dirty: string): string {
  if (!dirty) return "";

  // DOMParser builds an inert document: <img onerror> does not fire, external
  // resources are not fetched. Never use innerHTML on a live node here.
  const doc = new DOMParser().parseFromString(`<body>${dirty}</body>`, "text/html");
  const body = doc.body;
  if (!body) return "";

  const walk = (node: Element) => {
    // Snapshot children first — we mutate the tree as we go.
    for (const child of Array.from(node.children)) walk(child);

    const tag = node.tagName.toUpperCase();

    if (DROP_SUBTREE.has(tag)) {
      node.remove();
      return;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      // Unknown but harmless wrapper: keep the text, drop the element.
      node.replaceWith(...Array.from(node.childNodes));
      return;
    }

    const allowed = ALLOWED_ATTRS[tag] ?? new Set<string>();
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();

      // Every on* handler goes, unconditionally, whatever the tag.
      if (name.startsWith("on") || !allowed.has(name)) {
        node.removeAttribute(attr.name);
        continue;
      }

      if (name === "href") {
        if (!isSafeUrl(attr.value)) node.removeAttribute(attr.name);
        continue;
      }

      if (name === "src") {
        const ok = SAFE_IMG_DATA_URL.test(attr.value.trim()) || isSafeUrl(attr.value);
        if (!ok) node.removeAttribute(attr.name);
      }
    }

    // Any surviving link opens in a new tab without handing over window.opener.
    if (tag === "A" && node.hasAttribute("href")) {
      node.setAttribute("rel", "noopener noreferrer nofollow");
      node.setAttribute("target", "_blank");
    }
  };

  for (const child of Array.from(body.children)) walk(child);
  return body.innerHTML;
}
