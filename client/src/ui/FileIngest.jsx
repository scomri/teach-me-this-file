import { useState } from 'react';
import { ACCEPTED, ingestFile } from '../ingest/ingest.js';
import { detectScript } from '../ingest/script.js';
import { MAX_FILE_BYTES } from '../../../shared/limits.js';

const SHOWN = 200; // ponytail: dev view; a 20 MB file has ~14k chunks, too many to render at once

function where(c) {
  const page = c.page == null ? null : `page ${c.pageLabel ?? c.page}`;
  return [c.id, page, c.heading].filter(Boolean).join(' · ');
}

export default function FileIngest() {
  const [state, setState] = useState({ status: 'idle' });

  async function pick(e) {
    const file = e.target.files[0];
    e.target.value = ''; // so picking the same file again re-reads it
    if (!file) return;
    setState({ status: 'reading' });
    const t0 = performance.now();
    try {
      const doc = await ingestFile(file);
      setState({ status: 'done', doc, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      setState({ status: 'error', message: err.code ? err.message : "This file couldn't be read." });
    }
  }

  const { doc } = state;

  return (
    <section className="mt-6">
      <label className="block text-sm font-medium" htmlFor="file">
        Lesson file
      </label>
      <input id="file" className="mt-1 block w-full text-sm" type="file" accept={ACCEPTED.join(',')} onChange={pick} />
      <p className="mt-1 text-xs text-slate-500">
        {ACCEPTED.map((x) => x.slice(1).toUpperCase()).join(', ')} · up to {MAX_FILE_BYTES / 1024 / 1024} MB
      </p>

      <div aria-live="polite">
        {state.status === 'reading' && <p className="mt-3 text-sm text-slate-600">Reading file…</p>}
        {state.status === 'error' && (
          <p className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">{state.message}</p>
        )}
        {state.status === 'done' && (
          <div className="mt-3 text-sm">
            <p>
              <span className="font-medium">{doc.name}</span>: {doc.chunks.length.toLocaleString()} chunks,{' '}
              {doc.totalChars.toLocaleString()} characters
              {doc.totalPages && `, ${doc.totalPages} pages`} <span className="text-slate-500">({state.ms} ms)</span>
            </p>
            {doc.skippedPages.length > 0 && (
              <p className="mt-2 text-slate-600">No readable text on pages {doc.skippedPages.join(', ')}.</p>
            )}
          </div>
        )}
      </div>

      {doc && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-slate-600">
            Show chunks{doc.chunks.length > SHOWN && ` (first ${SHOWN})`}
          </summary>
          <ol className="mt-2 space-y-2">
            {doc.chunks.slice(0, SHOWN).map((c) => (
              <li key={c.id} className="rounded border border-slate-200 p-2">
                <p className="text-xs text-slate-500">{where(c)}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm" dir={detectScript(c.text).rtl ? 'rtl' : 'ltr'}>
                  {c.text}
                </p>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
