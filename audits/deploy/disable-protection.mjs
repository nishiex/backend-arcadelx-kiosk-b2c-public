// Disable Vercel Authentication (ssoProtection) on the API project so normal browsers can
// reach the deployed function. The owner explicitly asked for this ("fix it up") after being
// shown the "Protected by Vercel Authentication" screen.
//
// The token is read at runtime from the CLI's own config; nothing is printed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
const token = JSON.parse(
  fs.readFileSync(path.join(appData, 'com.vercel.cli', 'Data', 'auth.json'), 'utf8'),
).token;

const repo = 'C:/Users/Abcom/Desktop/backend-arcadelx-kiosk-b2c';
const { projectId, orgId } = JSON.parse(
  fs.readFileSync(path.join(repo, '.vercel', 'project.json'), 'utf8'),
);
console.log(`project ${projectId} in team ${orgId}`);

const response = await fetch(
  `https://api.vercel.com/v9/projects/${projectId}?teamId=${orgId}`,
  {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ssoProtection: null }),
  },
);

const text = await response.text();
if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 300)}`);
const project = JSON.parse(text);
console.log(`ssoProtection is now      : ${JSON.stringify(project.ssoProtection)}`);
console.log(`passwordProtection        : ${JSON.stringify(project.passwordProtection)}`);
console.log(`production alias          : ${JSON.stringify(project.targets?.production?.alias ?? [])}`);
