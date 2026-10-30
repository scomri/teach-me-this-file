import { useEffect, useRef, useState } from 'react';
import ModelSettings from './ui/ModelSettings.jsx';
import FileIngest from './ui/FileIngest.jsx';

export default function App() {
  const [api, setApi] = useState('checking...');
  const [text, setText] = useState('');
  const [out, setOut] = useState('');
  const [status, setStatus] = useState('');
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef(null);
  const idRef = useRef(null);
  const stopRef = useRef(false); // Stop clicked before the start event arrived

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setApi(d.ok ? 'ok' : 'error'))
      .catch(() => setApi('unreachable'));
  }, []);

  async function send() {
    const ac = new AbortController();
    let reader;
    abortRef.current = ac;
    idRef.current = null;
    stopRef.current = false;
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

      reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop(); // last piece may be a partial event
        for (const block of events) {
          let name = 'message';
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) name = line.slice(7);
            else if (line.startsWith('data: ')) data = line.slice(6);
          }
          if (!data) continue;
          const payload = JSON.parse(data);
          if (name === 'start') {
            idRef.current = payload.id;
            if (stopRef.current) stop();
          }
          else if (name === 'error') throw new Error(payload.error);
          else if (name === 'message') setOut((o) => o + payload.word + ' ');
        }
      }
      setStatus('done');
    } catch (err) {
      setStatus(err.name === 'AbortError' ? 'stopped' : `error: ${err.message}`);
    } finally {
      reader?.cancel().catch(() => {});
      setStreaming(false);
    }
  }

  function stop() {
    // Tell the server first: behind a proxy, closing our fetch may never reach it.
    const id = idRef.current;
    stopRef.current = true;
    if (!id) return; // cancel is sent when start arrives
    fetch('/api/streams/' + id + '/cancel', { method: 'POST', keepalive: true }).catch(() => {});
    abortRef.current?.abort();
  }

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold">Teach Me This File</h1>
      <ModelSettings />
      <p className="mt-2 text-slate-600">API: {api}</p>

      <FileIngest />

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
          onClick={stop}
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
