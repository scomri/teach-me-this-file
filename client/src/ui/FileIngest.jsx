import { useRef, useState } from 'react';
import { ACCEPTED, IngestError, ingestFile } from '../ingest/ingest.js';
import { textDir } from '../ingest/script.js';
import { MAX_FILE_MB } from '../../../shared/limits.js';

const SHOWN = 200; // ponytail: dev view; a 20 MB file has ~14k chunks, too many to render at once

const unit = (kind) => (kind === 'pptx' ? 'slide' : 'page');

function where(c, kind) {
  const page = c.page == null ? null : `${unit(kind)} ${c.pageLabel ?? c.page}`;
  return [c.id, page, c.heading].filter(Boolean).join(' · ');
}

export default function FileIngest({ onDoc, confirmPick }) {
  const [state, setState] = useState({ status: 'idle' });
  const inputRef = useRef(null);
  const requestRef = useRef(0);

  async function read(file, allowDamagedText = false) {
    const request = ++requestRef.current;
    setState({ status: 'reading' });
    onDoc?.(null);
    const t0 = performance.now();
    try {
      const doc = await ingestFile(file, { allowDamagedText, onProgress: (progress) => {
        if (request === requestRef.current) setState({ status: 'reading', progress });
      } });
      if (request !== requestRef.current) return;
      setState({ status: 'done', doc, damaged: allowDamagedText, ms: Math.round(performance.now() - t0) });
      onDoc?.(doc);
    } catch (err) {
      if (request !== requestRef.current) return;
      if (err instanceof IngestError && err.code === 'damaged_text') {
        setState({ status: 'damaged', file });
        return;
      }
      setState({ status: 'error', message: err instanceof IngestError ? err.message : "This file couldn't be read." });
    }
  }

  function pick(e) {
    const file = e.target.files[0];
    e.target.value = ''; // so picking the same file again re-reads it
    if (file && (confirmPick?.() ?? true)) read(file);
  }

  const { doc } = state;

  return (
    <section className="mt-6">
      <label className="block text-sm font-medium" htmlFor="file">
        Lesson file
      </label>
      <input ref={inputRef} id="file" className="mt-1 block w-full text-sm" type="file" accept={ACCEPTED.join(',')} onChange={pick} />
      <p className="mt-1 text-xs text-muted">
        {ACCEPTED.map((x) => x.slice(1).toUpperCase()).join(', ')} · up to {MAX_FILE_MB} MB
      </p>

      <div aria-live="polite">
        {state.status === 'reading' && (
          <p className="mt-3 text-sm text-muted">
            {state.progress ? `Reading page ${state.progress.page} of ${state.progress.total}…` : 'Reading file…'}
          </p>
        )}
        {state.status === 'error' && (
          <p className="mt-3 notice notice-danger text-sm">{state.message}</p>
        )}
        {state.status === 'damaged' && (
          <div className="mt-3 notice notice-warning text-sm">
            <p>Some text in this file may be damaged or missing. Missing characters will appear as � and may affect the lesson.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => read(state.file, true)}>Continue with damaged text</button>
              <button type="button" className="btn btn-secondary" onClick={() => inputRef.current?.click()}>Choose another file</button>
            </div>
          </div>
        )}
        {state.status === 'done' && (
          <div className="mt-3 text-sm">
            {state.damaged && <p className="notice notice-warning mb-2">Some text in this file may be damaged or missing. Missing characters appear as � and may affect the lesson.</p>}
            <p>
              <span className="font-medium">{doc.name}</span>: {doc.chunks.length.toLocaleString()} chunks,{' '}
              {doc.totalChars.toLocaleString()} characters
              {doc.totalPages && `, ${doc.totalPages} ${unit(doc.kind)}s`} <span className="text-muted">({state.ms} ms)</span>
            </p>
            {doc.skippedPages.length > 0 && (
              <p className="mt-2 text-muted">No readable text on {unit(doc.kind)}s {doc.skippedPages.join(', ')}.</p>
            )}
          </div>
        )}
      </div>

      {doc && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-muted">
            Show chunks{doc.chunks.length > SHOWN && ` (first ${SHOWN})`}
          </summary>
          <ol className="mt-2 space-y-2">
            {doc.chunks.slice(0, SHOWN).map((c) => (
              <li key={c.id} className="card p-2">
                <p className="text-xs text-muted">{where(c, doc.kind)}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm" dir={textDir(c.text)}>
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
