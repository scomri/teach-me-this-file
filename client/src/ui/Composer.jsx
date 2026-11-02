import { useRef } from 'react';
import { MAX_ANSWER_CHARS } from '../../../shared/limits.js';

// The answer box. While a turn is in progress it is read-only rather than disabled, so focus stays in it
// after Send; it is disabled only where no answer is expected (after a reveal, once the lesson is done).
// Enter sends and Shift+Enter adds a line.
export default function Composer({ draft, onDraft, onSend, readOnly, disabled, canSend }) {
  const box = useRef(null);
  const over = draft.length > MAX_ANSWER_CHARS;
  const sendable = canSend && !!draft.trim() && !over;
  function send() {
    if (!sendable) return;
    onSend();
    box.current?.focus();
  }
  return (
    <div>
      <label className="block text-sm font-medium" htmlFor="answer">Your answer</label>
      <textarea
        ref={box} id="answer" className="field mt-1 block w-full p-2" rows={2}
        value={draft} onChange={(e) => onDraft(e.target.value)} readOnly={readOnly} disabled={disabled} aria-describedby="answer-count"
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <p id="answer-count" className={`text-sm ${over ? 'text-danger' : 'text-muted'}`}>
          {draft.length} / {MAX_ANSWER_CHARS}{over && ' (too long, shorten it to send)'}
        </p>
        <button className="btn btn-primary" onClick={send} disabled={!sendable}>Send</button>
      </div>
    </div>
  );
}
