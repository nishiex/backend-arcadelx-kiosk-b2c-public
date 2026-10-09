// Set the Vercel project's Root Directory via the REST API.
//
// A Next.js app inside a monorepo must be built with its Root Directory pointed at the app,
// otherwise Vercel resolves package.json from the wrong place and reports "No Next.js version
// detected". The CLI has no flag for this, so the project is patched directly.
//
// The auth token is read at runtime from the CLI's own config file and never printed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// APPDATA is not always present in the spawned environment, so fall back to the profile path.
const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
const tokenPath = path.join(appData, 'com.vercel.cli', 'Data', 'auth.json');
const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8')).token;
if (!token) throw new Error('no token in the CLI auth file');

const project = path.join('C:/Users/Abcom/Desktop/backend-arcadelx-kiosk-b2c/apps/web/next-monorepo', '.vercel', 'project.json');
const { projectId, orgId } = JSON.parse(fs.readFileSync(project, 'utf8'));
console.log(`project ${projectId} in team ${orgId}`);

const rootDirectory = process.argv[2] ?? null;

async function patch(body) {
  const response = await fetch(`https://api.vercel.com/v9/projects/${projectId}?teamId=${orgId}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const updated = await patch({ rootDirectory });
console.log(`rootDirectory = ${JSON.stringify(updated.rootDirectory)}`);
console.log(`framework     = ${updated.framework}`);
console.log(`buildCommand  = ${updated.buildCommand}`);
console.log(`installCommand= ${updated.installCommand}`);
