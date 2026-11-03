import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { textDir } from '../ingest/script.js';
import { sourcePages } from '../plan.js';

// Tutor text is Markdown with raw HTML off (react-markdown shows it as text), so no sanitizer is needed.
// Every block gets dir="auto" so a Hebrew reply reads right to left (lists use inside markers because a
// container's auto direction ignores children that set their own dir, so the item decides). `strong` and `blockquote` carry class
// names that index.css styles as the key-term highlighter and the "From your file" quote box; images are
// dropped, so a reply cannot load anything from another site.
const element = (Tag, props) => ({ node, ...rest }) => <Tag {...props} {...rest} />;
const block = (Tag, className) => element(Tag, { dir: 'auto', className });
const heading = (Tag) => block(Tag, 'heading');
// A quote's direction comes from its text: dir="auto" would skip its paragraphs, which set their own.
const nodeText = (node) => node.value ?? node.children?.map(nodeText).join('') ?? '';
const quote = ({ node, ...rest }) => <blockquote {...rest} dir={textDir(nodeText(node))} className="tutor-source-quote" />;
const COMPONENTS = {
  p: block('p'), li: block('li'), ul: block('ul', 'list-disc list-inside'), ol: block('ol', 'list-decimal list-inside'),
  h1: heading('h3'), h2: heading('h3'), h3: heading('h3'), h4: heading('h4'), h5: heading('h5'), h6: heading('h6'),
  pre: block('pre', 'overflow-x-auto'), th: block('th'), td: block('td'),
  blockquote: quote,
  strong: element('strong', { className: 'tutor-key-term' }),
  a: element('a', { target: '_blank', rel: 'noopener noreferrer', className: 'underline' }),
  table: ({ node, ...props }) => <div className="overflow-x-auto"><table dir="auto" {...props} /></div>,
};
export const Reply = ({ children }) => <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS} disallowedElements={['img']}>{children}</Markdown>;

// One message. A tutor reply is a reading column with an accent rule on its inline-start side; a student
// message is a dashed card in plain text. A reply still being written shows a typing indicator and is aria-busy.
export default function Message({ message: m, source }) {
  if (m.role === 'student') {
    return (
      <li className="rounded-md border border-dashed border-border-strong bg-surface p-3">
        <p className="text-xs font-medium text-muted">You</p>
        <p dir="auto" className="whitespace-pre-wrap">{m.text}</p>
      </li>
    );
  }
  const pages = sourcePages(m, source);
  const writing = m.status === 'streaming';
  return (
    <li dir="auto" className="min-w-0 border-s-2 border-accent ps-4" aria-busy={writing}>
      <span className="block text-xs font-medium text-muted">Tutor</span>
      {m.text ? <div className="min-w-0 space-y-2"><Reply>{m.text}</Reply></div> : writing && <span className="typing-indicator" aria-hidden="true"><span /><span /><span /></span>}
      {m.status === 'stopped' && <p className="mt-1 text-xs text-muted">Stopped.</p>}
      {m.chunkIds?.length > 0 && <details className="mt-2 text-sm">
        <summary className="cursor-pointer py-2.5 leading-6 text-muted">Source{pages ? `: ${pages}` : ' passages'}</summary>
        <div className="space-y-2 border-s border-border ps-3">
          {source.chunks.filter((c) => m.chunkIds.includes(c.id)).map((c) => <p key={c.id} dir="auto" className="whitespace-pre-wrap">{c.text}</p>)}
        </div>
      </details>}
    </li>
  );
}
