// Runs the API (with --watch) and the Vite dev server together, cross-platform.
import { spawn } from 'node:child_process';

const run = (args, env) => spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...env } });

const procs = [
  // The Vite proxy targets :8080; an inherited PORT (e.g. 5173) would break it.
  run(['--watch', 'server/index.js'], { PORT: '8080' }),
  run(['node_modules/vite/bin/vite.js', 'client']),
];
const stop = () => procs.forEach((p) => p.kill());
procs.forEach((p) => p.on('exit', stop));
process.on('SIGINT', stop);
