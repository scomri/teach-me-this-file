import { useEffect, useState } from 'react';

export default function App() {
  const [api, setApi] = useState('checking...');

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setApi(d.ok ? 'ok' : 'error'))
      .catch(() => setApi('unreachable'));
  }, []);

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold">Teach Me This File</h1>
      <p className="mt-2 text-slate-600">API: {api}</p>
    </main>
  );
}
