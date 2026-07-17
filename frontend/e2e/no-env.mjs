// Preload for the required ordinary build command. Make env files absent before
// any reader opens them; normal source/configuration reads remain unchanged.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
const hidden = path => {
  const name = path instanceof URL ? fileURLToPath(path) : String(path);
  return /^\.env(?:\.|$)/.test(basename(name));
};
const missing = () => Object.assign(new Error('Environment files are disabled for local checks'), { code: 'ENOENT' });
const statSync = fs.statSync;
fs.statSync = function (path, ...args) { if (hidden(path)) { if (args[0]?.throwIfNoEntry === false) return undefined; throw missing(); } return statSync.call(this, path, ...args); };
const existsSync = fs.existsSync;
fs.existsSync = function (path) { return hidden(path) ? false : existsSync.call(this, path); };
const readSync = fs.readFileSync;
fs.readFileSync = function (path, ...args) { if (hidden(path)) throw missing(); return readSync.call(this, path, ...args); };
const read = fs.readFile;
fs.readFile = function (path, ...args) { if (hidden(path)) { queueMicrotask(() => args.at(-1)(missing())); return; } return read.call(this, path, ...args); };
const readPromise = fs.promises.readFile;
fs.promises.readFile = async function (path, ...args) { if (hidden(path)) throw missing(); return readPromise.call(this, path, ...args); };
syncBuiltinESMExports();
