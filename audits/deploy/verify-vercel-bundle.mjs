// Prove the Vercel function bundle actually works, without deploying.
//
// The bundle inlines only first-party code, so a copy of it outside the project is a fair
// model of Vercel: dependencies come from npm, first-party code is baked in. Steps:
//   1. copy the bundle to a temp directory outside the api project;
//   2. junction node_modules at the REPO ROOT, which is where npm workspaces hoist
//      dependencies, plus the api's own node_modules for anything not hoisted;
//   3. import it and drive the real Express app with mock req/res.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const repoRoot = 'C:/Users/Abcom/Desktop/backend-arcadelx-kiosk-b2c';
const apiRoot = path.join(repoRoot, 'apps', 'api');
const entry = path.join(repoRoot, 'api', 'index.mjs');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'arcadelx-fn-'));
fs.copyFileSync(entry, path.join(sandbox, 'index.mjs'));

// Mirror npm workspace hoisting: root node_modules, with the api's on top.
execFileSync('cmd', ['/c', 'mklink', '/J',
  path.join(sandbox, 'node_modules'), path.join(repoRoot, 'node_modules')], { stdio: 'ignore' });

// The generated Prisma client is external and lives in the api source tree.
const generated = path.join(apiRoot, 'src', 'generated');
if (fs.existsSync(generated)) {
  fs.mkdirSync(path.join(sandbox, 'generated'), { recursive: true });
  fs.cpSync(generated, path.join(sandbox, 'generated'), { recursive: true, dereference: true });
}

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
  if (!ok) failures.push(name);
};

process.chdir(sandbox);

// env.ts validates at import time, so the variables must exist before the bundle loads.
// Values come from the local .env (development database) purely so the config is valid;
// this test never writes to any database.
const envText = fs.readFileSync(path.join(repoRoot, '.env'), 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
  const index = trimmed.indexOf('=');
  const key = trimmed.slice(0, index).trim();
  const value = trimmed.slice(index + 1).trim().replace(/^"|"$/g, '');
  if (process.env[key] === undefined) process.env[key] = value;
}
// The platform sets this; without it the invoice directory would default to cwd/invoices.
process.env.VERCEL = '1';

let handler;
try {
  handler = (await import(pathToFileURL(path.join(sandbox, 'index.mjs')).href)).default;
  check('bundle boots from outside the project', typeof handler === 'function');
} catch (error) {
  check('bundle boots from outside the project', false, error.message);
}

if (handler) {
  const { EventEmitter } = await import('node:events');

  // A faithful-enough http.ServerResponse: finalhandler inspects stream state on the 404
  // path, so the mock must extend a real Writable rather than stand in loosely.
  const { Writable } = await import('node:stream');

  function invoke(method, url, body) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      const request = Object.assign(new EventEmitter(), {
        method, url, body,
        headers: { host: 'localhost', 'content-type': 'application/json' },
        socket: { remoteAddress: '127.0.0.1' }, httpVersion: '1.1', connection: {},
        readable: true, complete: true,
      });

      const response = new Writable({
        write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); },
      });
      Object.assign(response, {
        statusCode: 200,
        headersSent: false,
        finished: false,
        _headers: {},
        socket: { remoteAddress: '127.0.0.1' },
        setHeader(k, v) { this._headers[k.toLowerCase()] = v; return this; },
        getHeader(k) { return this._headers[k.toLowerCase()]; },
        getHeaders() { return { ...this._headers }; },
        removeHeader(k) { delete this._headers[k.toLowerCase()]; },
        hasHeader(k) { return k.toLowerCase() in this._headers; },
        writeHead(code, extra) {
          this.statusCode = code;
          Object.assign(this._headers, extra ?? {});
          this.headersSent = true;
          return this;
        },
        get statusMessage() { return ''; },
        flushHeaders() { this.headersSent = true; },
        end(chunk, encoding, callback) {
          if (chunk) chunks.push(Buffer.from(chunk));
          this.finished = true;
          Writable.prototype.end.call(this, undefined, undefined, () => {
            resolve({ status: this.statusCode, body: Buffer.concat(chunks).toString('utf8') });
            if (typeof callback === 'function') callback();
            else if (typeof encoding === 'function') encoding();
          });
          return this;
        },
      });

      Promise.resolve().then(() => handler(request, response)).catch(reject);
      if (body) request.emit('data', Buffer.from(body));
      request.emit('end');
    });
  }

  const source = fs.readFileSync(path.join(sandbox, 'index.mjs'), 'utf8');
  check('no bare @shared-types specifier remains', !/from\s*["']@shared-types\//.test(source));
  check('no relative ../src import remains', !/from\s*["']\.\.\/src\//.test(source));
  check('Zod schemas inlined as runtime values',
    /CreateAgreementSchema|ApproveRequestSchema|PaginationQuerySchema/.test(source));

  try {
    const health = await invoke('GET', '/health');
    check('GET /health routes through Express', health.status === 200,
      `status ${health.status} body ${health.body.slice(0, 50)}`);
  } catch (error) {
    check('GET /health routes through Express', false, error.message);
  }

  try {
    const missing = await invoke('GET', '/api/definitely-not-a-route');
    check('unknown /api route returns 404, not a crash', missing.status === 404, `status ${missing.status}`);
  } catch (error) {
    check('unknown /api route returns 404, not a crash', false, error.message);
  }

  // Reaching a controller exercises controller -> aliased Zod -> Prisma.
  try {
    const invalid = await invoke('POST', '/api/auth/login', JSON.stringify({}));
    const body = invalid.body.slice(0, 90);
    check('POST /api/auth/login reaches validation',
      invalid.status === 400 || /invalid|required|email/i.test(body),
      `status ${invalid.status} body ${body}`);
  } catch (error) {
    check('POST /api/auth/login reaches validation', false, error.message);
  }
}

console.log(`\n${failures.length === 0 ? 'ALL PASS' : 'FAILURES: ' + failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
