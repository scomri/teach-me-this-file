import { useEffect, useRef, useState } from 'react';

export default function App() {
  const [api, setApi] = useState('checking...');
  const [text, setText] = useState('');
  const [out, setOut] = useState('');
  const [status, setStatus] = useState('');
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setApi(d.ok ? 'ok' : 'error'))
      .catch(() => setApi('unreachable'));
  }, []);

  async function send() {
    const ac = new AbortController();
    abortRef.current = ac;
    setOut('');
    setStatus('');
    setStreaming(true);
    try {
      const res = await fetch('/api/echo-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: ac.signal,
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop(); // last piece may be a partial event
        for (const event of events) {
          // `event: done` blocks don't start with `data: `, so they are skipped.
          if (event.startsWith('data: ')) setOut((o) => o + JSON.parse(event.slice(6)).word + ' ');
        }
      }
      setStatus('done');
    } catch (err) {
      setStatus(err.name === 'AbortError' ? 'stopped' : `error: ${err.message}`);
    } finally {
      setStreaming(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold">Teach Me This File</h1>
      <p className="mt-2 text-slate-600">API: {api}</p>

      <textarea
        className="mt-6 w-full rounded border border-slate-300 p-2"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type something to echo back word by word"
      />
      <div className="mt-2 flex gap-2">
        <button
          className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-40"
          onClick={send}
          disabled={streaming || !text.trim()}
        >
          Send
        </button>
        <button
          className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
          onClick={() => abortRef.current?.abort()}
          disabled={!streaming}
        >
          Stop
        </button>
      </div>
      <p className="mt-4 min-h-6">{out}</p>
      <p className="text-sm text-slate-500">{status}</p>
    </main>
  );
}
