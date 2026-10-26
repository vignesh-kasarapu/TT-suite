// Minimal markdown -> React (FR-016): paragraphs, headings, bullet lists, **bold**, *italic*,
// `code`, [text](https://...) links. Builds elements, never HTML, so nothing can be injected.
// ponytail: covers what comments and descriptions need; swap for marked+DOMPurify if tables or
// images are ever wanted.
import type { ReactNode } from 'react';

// D-158: `@[Name](user:<id>)` is a mention and shows as "@Name".
const INLINE =
  /(@\[[^\]]+\]\(user:[0-9A-Z]{26}\)|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/|\/)[^)\s]+\))/g;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith('@[')) {
      out.push(
        <span key={k} className="mention">
          {`@${tok.slice(2, tok.indexOf(']('))}`}
        </span>,
      );
    } else if (tok.startsWith('**')) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('[')) {
      const close = tok.indexOf('](');
      const label = tok.slice(1, close);
      const href = tok.slice(close + 2, -1);
      out.push(
        <a
          key={k}
          href={href}
          rel="noopener noreferrer"
          target={href.startsWith('/') ? undefined : '_blank'}
        >
          {label}
        </a>,
      );
    } else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className }: { text: string; className?: string | undefined }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => {
    if (para.length)
      blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(' '), `p${blocks.length}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (list.length)
      blocks.push(
        <ul key={`l${blocks.length}`}>
          {list.map((item, i) => (
            <li key={i}>{inline(item, `l${blocks.length}-${i}`)}</li>
          ))}
        </ul>,
      );
    list = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      const level = h[1]?.length ?? 1;
      const body = inline(h[2] ?? '', `h${blocks.length}`);
      blocks.push(
        level === 1 ? (
          <h3 key={`h${blocks.length}`}>{body}</h3>
        ) : (
          <h4 key={`h${blocks.length}`}>{body}</h4>
        ),
      );
    } else if (li) {
      flushPara();
      list.push(li[1] ?? '');
    } else if (line.trim() === '') {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <div className={className}>{blocks}</div>;
}
