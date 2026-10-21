/**
 * A deliberately small Markdown subset for knowledge articles. It parses to
 * plain data that the UI renders as React elements, so article text can never
 * inject HTML. Supported:
 *
 *   ## Heading / ### Subheading
 *   - bullet          1. numbered          - [ ] checklist item
 *   > quote / callout (a first line of **Bold** becomes its title)
 *   ``` code block ```
 *   inline **bold**, `code`, [text](https://link)
 */
export type Inline = { t: "text"; v: string } | { t: "b"; v: string } | { t: "code"; v: string } | { t: "link"; v: string; href: string };

export type Block =
  | { t: "h2" | "h3" | "p"; c: Inline[] }
  | { t: "ul" | "ol" | "check"; items: Inline[][] }
  | { t: "quote"; title: Inline[] | null; c: Inline[][] }
  | { t: "code"; v: string };

const SAFE_HREF = /^(https:\/\/[^\s"'<>]+|mailto:[^\s"'<>@]+@[^\s"'<>]+|\/portal\/[^\s"'<>]*)$/i;

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push({ t: "text", v: s.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "b", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "code", v: m[2] });
    else if (SAFE_HREF.test(m[4])) out.push({ t: "link", v: m[3], href: m[4] });
    else out.push({ t: "text", v: m[3] });
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ t: "text", v: s.slice(last) });
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push({ t: "code", v: code.join("\n") });
      continue;
    }
    const h = /^(#{2,3})\s+(.+)$/.exec(line);
    if (h) {
      blocks.push({ t: h[1].length === 2 ? "h2" : "h3", c: parseInline(h[2].trim()) });
      i++;
      continue;
    }
    if (/^\s*-\s+\[[ xX]\]\s+/.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*-\s+\[[ xX]\]\s+/.test(lines[i])) items.push(parseInline(lines[i++].replace(/^\s*-\s+\[[ xX]\]\s+/, "")));
      blocks.push({ t: "check", items });
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]) && !/^\s*-\s+\[[ xX]\]\s+/.test(lines[i])) items.push(parseInline(lines[i++].replace(/^\s*[-*]\s+/, "")));
      blocks.push({ t: "ul", items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(parseInline(lines[i++].replace(/^\s*\d+[.)]\s+/, "")));
      blocks.push({ t: "ol", items });
      continue;
    }
    if (line.startsWith(">")) {
      const q: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) q.push(lines[i++].replace(/^>\s?/, ""));
      const titleMatch = /^\*\*([^*]+)\*\*\s*$/.exec(q[0] ?? "");
      blocks.push({ t: "quote", title: titleMatch ? parseInline(titleMatch[1]) : null, c: (titleMatch ? q.slice(1) : q).filter((l) => l.trim()).map(parseInline) });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|```|>|\s*[-*]\s+|\s*\d+[.)]\s+)/.test(lines[i])) para.push(lines[i++].trim());
    blocks.push({ t: "p", c: parseInline(para.join(" ")) });
  }
  return blocks;
}

/** Plain text (for summaries, search snippets and AI context). */
export function markdownToText(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*`]|^\s*-\s+\[[ xX]\]\s+|^\s*[-*]\s+|^\s*\d+[.)]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
