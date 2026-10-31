import { useEffect, useReducer, useRef, useState } from 'react';
import { initialLesson, reduce, normalizeSaved, savedRecord } from './lesson/lesson.js';
import { clearSaved, loadSaved, putSaved, shouldSave } from './lesson/persist.js';
import ModelSettings from './ui/ModelSettings.jsx';
import FileIngest from './ui/FileIngest.jsx';
import Lesson from './ui/Lesson.jsx';
import PlanLesson from './ui/PlanLesson.jsx';

// lessonRestored swaps in the lesson loaded at startup; the lesson reducer itself does not know about storage.
const reduceApp = (state, event) => (event.type === 'lessonRestored' ? event.lesson : reduce(state, event));
const storageNotice = 'Browser storage is unavailable. This lesson is kept in memory and will be lost on refresh.';
const versionNotice = 'The saved lesson was made by an older version of the app and could not be opened.';

export default function App() {
  const [api, setApi] = useState('checking...');
  const [text, setText] = useState('');
  const [out, setOut] = useState('');
  const [status, setStatus] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [lesson, dispatch] = useReducer(reduceApp, undefined, initialLesson);
  const [loaded, setLoaded] = useState(false); // avoids a flash of the empty screen before the saved lesson arrives
  const [lessonNotice, setLessonNotice] = useState('');
  const [restored, setRestored] = useState(false);
  const [fresh, setFresh] = useState(0); // remounts the file picker on New lesson
  const savedRef = useRef(null); // the last state handed to storage; null once storage is known unavailable
  const prevRef = useRef(null);
  const [settings, setSettings] = useState(null);
  const [saveCount, setSaveCount] = useState(0);
  const settingsRef = useRef(null);
  const abortRef = useRef(null);
  const idRef = useRef(null);
  const stopRef = useRef(false); // Stop clicked before the start event arrived

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setApi(d.ok ? 'ok' : 'error'))
      .catch(() => setApi('unreachable'));
  }, []);

  useEffect(() => {
    let live = true;
    loadSaved().then((saved) => {
      if (!live) return;
      const { lesson: found, discarded } = normalizeSaved(saved);
      if (discarded) { setLessonNotice(versionNotice); clearSaved().catch(() => {}); }
      if (found) { dispatch({ type: 'lessonRestored', lesson: found }); setRestored(true); }
      prevRef.current = found ?? initialLesson();
      setLoaded(true);
    }).catch(() => {
      if (!live) return;
      setLessonNotice(storageNotice);
      savedRef.current = false;
      setLoaded(true);
    });
    return () => { live = false; };
  }, []);

  useEffect(() => { // save after every change except stream chunks; an empty lesson clears the record
    if (!loaded || savedRef.current === false || !prevRef.current) return;
    const prev = prevRef.current;
    prevRef.current = lesson;
    if (!shouldSave(prev, lesson)) return;
    const empty = !lesson.source && !lesson.teacher.prompt;
    (empty ? clearSaved() : putSaved(savedRecord(lesson))).catch(() => { savedRef.current = false; setLessonNotice(storageNotice); });
  }, [lesson, loaded]);

  function newLesson() {
    if (lesson.source && !window.confirm('Start a new lesson? The current lesson will be deleted.')) return;
    dispatch({ type: 'newLesson' });
    setRestored(false);
    setFresh((n) => n + 1);
  }
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
      if (!res.ok) {
        const body = await res.json().catch((err) => {
          if (err.name === 'AbortError') throw err;
          return null;
        });
        throw new Error(body?.error || `HTTP ${res.status}`);
      }

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
      <ModelSettings
        ref={settingsRef}
        onSettings={setSettings}
        onSaved={(saved) => { setSettings(saved); setSaveCount((n) => n + 1); }}
      />
      <p className="mt-2 text-slate-600">API: {api}</p>

      {lessonNotice && <p role="status" className="mt-2 text-sm text-amber-900">{lessonNotice}</p>}
      <FileIngest key={fresh} onDoc={(source) => { setRestored(false); dispatch({ type: 'fileRead', source }); }} />
      {restored && lesson.source && <p className="mt-2 text-sm text-slate-600">Restored your lesson on {lesson.source.name}.</p>}
      {(lesson.source || lesson.teacher.prompt) && <button type="button" className="mt-2 rounded border border-slate-300 px-3 py-1 text-sm" onClick={newLesson}>New lesson</button>}
      {loaded && lesson.progress && settings && <Lesson lesson={lesson} dispatch={dispatch} settings={settings} openSettings={() => settingsRef.current.open()} />}
      {loaded && lesson.source && settings && !lesson.progress && <PlanLesson lesson={lesson} dispatch={dispatch} settings={settings} saveCount={saveCount} openSettings={() => settingsRef.current.open()} />}

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
