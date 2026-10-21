import { parseMarkdown, type Inline } from "@/lib/kb/markdown";

/** Renders the knowledge-base Markdown subset as React elements (never as raw HTML). */
function Inlines({ c }: { c: Inline[] }) {
  return (
    <>
      {c.map((x, i) =>
        x.t === "b" ? (
          <strong key={i}>{x.v}</strong>
        ) : x.t === "code" ? (
          <code key={i}>{x.v}</code>
        ) : x.t === "link" ? (
          <a key={i} href={x.href} {...(x.href.startsWith("https://") ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}>
            {x.v}
          </a>
        ) : (
          <span key={i}>{x.v}</span>
        ),
      )}
    </>
  );
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="prose">
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h2":
            return <h2 key={i}><Inlines c={b.c} /></h2>;
          case "h3":
            return <h3 key={i}><Inlines c={b.c} /></h3>;
          case "p":
            return <p key={i}><Inlines c={b.c} /></p>;
          case "ul":
            return <ul key={i}>{b.items.map((it, j) => <li key={j}><Inlines c={it} /></li>)}</ul>;
          case "ol":
            return <ol key={i}>{b.items.map((it, j) => <li key={j}><Inlines c={it} /></li>)}</ol>;
          case "check":
            return <ul key={i} className="checklist">{b.items.map((it, j) => <li key={j}><Inlines c={it} /></li>)}</ul>;
          case "quote":
            return (
              <aside key={i} className="callout">
                {b.title && <strong className="callout-title"><Inlines c={b.title} /></strong>}
                {b.c.map((l, j) => <p key={j}><Inlines c={l} /></p>)}
              </aside>
            );
          case "code":
            return <pre key={i} tabIndex={0}><code>{b.v}</code></pre>;
        }
      })}
    </div>
  );
}
