// Runs the API (with --watch) and the Vite dev server together, cross-platform.
import { spawn } from 'node:child_process';

const run = (...args) => spawn(process.execPath, args, { stdio: 'inherit' });

const procs = [
  run('--watch', 'server/index.js'),
  run('node_modules/vite/bin/vite.js', 'client'),
];
const stop = () => procs.forEach((p) => p.kill());
procs.forEach((p) => p.on('exit', stop));
process.on('SIGINT', stop);
