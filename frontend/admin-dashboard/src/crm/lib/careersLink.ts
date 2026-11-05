/** Careers link helpers (3 Nov 2026) — PURE, no imports, so they test fast. */

/** PURE — the link for one channel (`?src=linkedin`); "" = no source. */
export function channelUrl(url: string, src: string): string {
  if (!src) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("src", src);
    return u.toString();
  } catch {
    return `${url}${url.includes("?") ? "&" : "?"}src=${encodeURIComponent(src)}`;
  }
}

/** PURE — the ready-to-paste post naming EVERY position switched on (5 Nov 2026,
 *  user ask: the post follows the "On the page now" switches, no "…and N more"). */
export function buildPost(
  positions: { title: string; city?: string; experience?: string }[],
  url: string,
): string {
  const lines = ["We are hiring engineers for automotive, embedded and Android projects.", ""];
  if (positions.length) {
    lines.push("Open now:");
    for (const p of positions) {
      const bits = [p.city && p.city !== "Other" ? p.city : "", p.experience || ""].filter(Boolean).join(", ");
      lines.push(`• ${p.title}${bits ? ` — ${bits}` : ""}`);
    }
    lines.push("");
  }
  lines.push("See every opening and apply in two minutes:", url, "", "#hiring #automotive #embedded #android");
  return lines.join("\n");
}

/** PURE — the post with the base link swapped for the channel's link. */
export function channelPost(post: string, url: string, src: string): string {
  return post.split(url).join(channelUrl(url, src));
}

