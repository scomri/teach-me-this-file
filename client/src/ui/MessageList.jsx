import Message from './Message.jsx';

// The transcript. Not a live region: a screen reader would read a streamed reply chunk by chunk (Lesson.jsx
// announces each reply once, when it finishes).
export default function MessageList({ messages, source }) {
  return (
    <ol className="mt-4 space-y-5">
      {messages.map((m, i) => <Message key={i} message={m} source={source} />)}
    </ol>
  );
}
