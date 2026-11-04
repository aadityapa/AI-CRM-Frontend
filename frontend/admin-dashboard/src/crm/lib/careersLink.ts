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

/** PURE — the post with the base link swapped for the channel's link. */
export function channelPost(post: string, url: string, src: string): string {
  return post.split(url).join(channelUrl(url, src));
}

