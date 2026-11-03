import { useEffect, useReducer, useRef, useState } from 'react';
import { initialLesson, reduce, normalizeSaved, screenOf } from './lesson/lesson.js';
import { clearSaved, loadSaved, putSaved, shouldSave } from './lesson/persist.js';
import ModelSettings from './ui/ModelSettings.jsx';
import FileIngest, { DAMAGED_NOTICE } from './ui/FileIngest.jsx';
import Header from './ui/Header.jsx';
import Lesson from './ui/Lesson.jsx';
import PlanLesson from './ui/PlanLesson.jsx';
import StepOutline from './ui/StepOutline.jsx';

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

  // When the screen changes, focus moves to its h1. Not on the first screen after loading (the settings dialog may
  // be open), and the done screen keeps the scroll position, so the recap being read stays in view.
  // The h1 belongs to whichever component draws the screen, so it is found in the DOM rather than through a ref.
  const screen = loaded ? screenOf(lesson) : null;
  const shown = useRef(null);
  useEffect(() => {
    const prev = shown.current;
    shown.current = screen;
    if (!prev || prev === screen || document.querySelector('dialog[open]')) return;
    document.querySelector('main h1')?.focus({ preventScroll: screen === 'done' });
  }, [screen]);
  const inLesson = screen === 'lesson' || screen === 'done';
  const teacherScreen = screen === 'setup' || screen === 'plan'; // file and plan are the teacher's; the chat is the student's
  const openSettings = () => settingsRef.current.open();

  return (
    <>
      <Header lesson={lesson} onNewLesson={lesson.source || lesson.teacher.prompt ? newLesson : undefined}>
        <ModelSettings
          ref={settingsRef}
          onSettings={setSettings}
          onSaved={(saved) => { setSettings(saved); setSaveCount((n) => n + 1); }}
        />
      </Header>
      <main className={`mx-auto max-w-xl px-4 pt-6 ${inLesson ? 'md:grid md:max-w-4xl md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8' : 'pb-12'}`}>
        {inLesson && <StepOutline lesson={lesson} />}
        <div className="min-w-0">
          {teacherScreen && <h1 key={screen} tabIndex={-1} className="heading text-2xl">{screen === 'setup' ? 'Start a lesson from a file' : 'Plan the lesson'}</h1>}
          {lessonNotice && <p role="status" className="mt-2 text-sm text-warning">{lessonNotice}</p>}
          {teacherScreen && <FileIngest key={fresh} confirmPick={confirmDiscard} onDoc={(source) => { setRestored(false); dispatch({ type: 'fileRead', source }); }} />}
          {lesson.source && (restored || inLesson) && <p className="mt-2 text-sm text-muted">{restored ? 'Restored your lesson on' : 'Teaching from'} {lesson.source.name}.</p>}
          {inLesson && lesson.source.damaged && <p className="mt-2 notice notice-warning text-sm">{DAMAGED_NOTICE}</p>}
          {inLesson && settings && <Lesson lesson={lesson} dispatch={dispatch} settings={settings} saveCount={saveCount} openSettings={openSettings} />}
          {screen === 'plan' && settings && <PlanLesson lesson={lesson} dispatch={dispatch} settings={settings} saveCount={saveCount} openSettings={openSettings} />}
        </div>
      </main>
    </>
  );
}
