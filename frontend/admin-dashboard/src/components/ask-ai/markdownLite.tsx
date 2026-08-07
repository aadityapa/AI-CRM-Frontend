/** Minimal safe Markdown renderer for Ask AI replies (no new deps). */
import type { ReactNode } from "react";

/** Inline: **bold**, `code`, [text](url) — urls limited to http(s), /, or #. */
function inlineMd(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key++} className="rounded bg-surface-2 px-1 py-0.5 text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      const lm = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (lm) {
        const href = lm[2];
        const safe = /^(https?:\/\/|\/|#)/i.test(href) ? href : "#";
        nodes.push(
          <a
            key={key++}
            href={safe}
            className="text-brand-600 underline underline-offset-2"
            target="_blank"
            rel="noreferrer"
          >
            {lm[1]}
          </a>,
        );
      }
    }
    last = m.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function MarkdownLite({ text }: { text: string }) {
  const lines = (text || "").split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let listBuf: string[] = [];
  let key = 0;

  const flushList = () => {
    if (!listBuf.length) return;
    blocks.push(
      <ul key={key++} className="my-1.5 list-disc space-y-0.5 pl-4">
        {listBuf.map((item, i) => (
          <li key={i}>{inlineMd(item)}</li>
        ))}
      </ul>,
    );
    listBuf = [];
  };

  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      listBuf.push(bullet[1]);
      continue;
    }
    flushList();
    if (!line.trim()) {
      blocks.push(<div key={key++} className="h-2" />);
      continue;
    }
    if (/^###\s+/.test(line)) {
      blocks.push(
        <h4 key={key++} className="mt-2 text-sm font-bold text-primary">
          {inlineMd(line.replace(/^###\s+/, ""))}
        </h4>,
      );
    } else if (/^##\s+/.test(line)) {
      blocks.push(
        <h3 key={key++} className="mt-2 text-sm font-bold text-primary">
          {inlineMd(line.replace(/^##\s+/, ""))}
        </h3>,
      );
    } else if (/^#\s+/.test(line)) {
      blocks.push(
        <h3 key={key++} className="mt-2 text-base font-bold text-primary">
          {inlineMd(line.replace(/^#\s+/, ""))}
        </h3>,
      );
    } else {
      blocks.push(
        <p key={key++} className="text-sm leading-relaxed text-secondary">
          {inlineMd(line)}
        </p>,
      );
    }
  }
  flushList();
  return <div className="space-y-0.5">{blocks}</div>;
}
