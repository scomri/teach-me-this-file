import { useEffect, useReducer, useRef, useState } from 'react';
import { initialLesson, reduce, normalizeSaved } from './lesson/lesson.js';
import { clearSaved, loadSaved, putSaved, shouldSave } from './lesson/persist.js';
import ModelSettings from './ui/ModelSettings.jsx';
import FileIngest from './ui/FileIngest.jsx';
import Lesson from './ui/Lesson.jsx';
import PlanLesson from './ui/PlanLesson.jsx';

// lessonRestored swaps in the lesson loaded at startup; the lesson reducer itself does not know about storage.
const reduceApp = (state, event) => (event.type === 'lessonRestored' ? event.lesson : reduce(state, event));
const storageNotice = 'Browser storage is unavailable. This lesson is kept in memory and will be lost on refresh.';
const versionNotice = 'The saved lesson was made by a different version of the app and could not be opened.';

export default function App() {
  const [lesson, dispatch] = useReducer(reduceApp, undefined, initialLesson);
  const [loaded, setLoaded] = useState(false); // avoids a flash of the empty screen before the saved lesson arrives
  const [lessonNotice, setLessonNotice] = useState('');
  const [restored, setRestored] = useState(false);
  const [fresh, setFresh] = useState(0); // remounts the file picker on New lesson
  const storageOff = useRef(false); // set once storage fails: the lesson stays in memory
  const prevRef = useRef(null);
  const [settings, setSettings] = useState(null);
  const [saveCount, setSaveCount] = useState(0);
  const settingsRef = useRef(null);

  useEffect(() => {
    let live = true;
    loadSaved().then((saved) => {
      if (!live) return;
      const { lesson: found, discarded } = normalizeSaved(saved);
      if (discarded) { setLessonNotice(versionNotice); clearSaved().catch(() => {}); }
      if (found) { dispatch({ type: 'lessonRestored', lesson: found }); setRestored(true); }
      setLoaded(true);
    }).catch(() => {
      if (!live) return;
      setLessonNotice(storageNotice);
      storageOff.current = true;
      setLoaded(true);
    });
    return () => { live = false; };
  }, []);

  useEffect(() => { // save after every change except stream chunks; an empty lesson clears the record
    if (!loaded || storageOff.current) return;
    const prev = prevRef.current;
    prevRef.current = lesson;
    if (!prev) return; // the first state after the load is what was loaded: nothing to write
    if (!shouldSave(prev, lesson)) return;
    const empty = !lesson.source && !lesson.teacher.prompt;
    (empty ? clearSaved() : putSaved(lesson)).catch(() => { storageOff.current = true; setLessonNotice(storageNotice); });
  }, [lesson, loaded]);

  const confirmDiscard = () => !lesson.source || window.confirm('Start a new lesson? The current lesson will be deleted.');

  function newLesson() {
    if (!confirmDiscard()) return;
    dispatch({ type: 'newLesson' });
    setRestored(false);
    setFresh((n) => n + 1);
  }
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-3xl font-black tracking-tight">Teach Me This File</h1>
      <ModelSettings
        ref={settingsRef}
        onSettings={setSettings}
        onSaved={(saved) => { setSettings(saved); setSaveCount((n) => n + 1); }}
      />

      {lessonNotice && <p role="status" className="mt-2 text-sm text-warning">{lessonNotice}</p>}
      {loaded && <FileIngest key={fresh} confirmPick={confirmDiscard} onDoc={(source) => { setRestored(false); dispatch({ type: 'fileRead', source }); }} />}
      {restored && lesson.source && <p className="mt-2 text-sm text-muted">Restored your lesson on {lesson.source.name}.</p>}
      {(lesson.source || lesson.teacher.prompt) && <button type="button" className="btn btn-secondary mt-2 text-sm" onClick={newLesson}>New lesson</button>}
      {loaded && lesson.progress && settings && <Lesson lesson={lesson} dispatch={dispatch} settings={settings} saveCount={saveCount} openSettings={() => settingsRef.current.open()} />}
      {loaded && lesson.source && settings && !lesson.progress && <PlanLesson lesson={lesson} dispatch={dispatch} settings={settings} saveCount={saveCount} openSettings={() => settingsRef.current.open()} />}
    </main>
  );
}
