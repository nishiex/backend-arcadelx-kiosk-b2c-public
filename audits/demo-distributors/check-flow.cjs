const fs = require('node:fs');
const dotenv = require('dotenv');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const env = dotenv.parse(fs.readFileSync(path.join(root, '.env')));
const target = new URL(env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/arcadelx_local') throw Error('Local target required');
const accounts = dotenv.parse(fs.readFileSync(path.join(root, '.env.demo-distributors.local')));
async function main() {
  const results = [];
  for (const key of ['PUNE', 'MUMBAI']) {
    let cookie = '';
    const checks = [];
    async function request(route, body) {
      const response = await fetch('http://localhost:3000' + route, {
        method: body ? 'POST' : 'GET',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(5000),
      });
      if (route === '/api/auth/login') cookie = response.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
      const json = await response.json();
      const data = json.data;
      checks.push({ route, status: response.status,
        ...(route === '/api/auth/me' ? { organization: data?.user?.membership?.organization?.name, role: data?.user?.membership?.role, membership: data?.user?.membership?.status } : {}),
        ...(data?.meta ? { total: data.meta.total } : {}),
        ...(data?.orders ? { total: data.orders.length } : {}),
        ...(route === '/api/workflows' ? { readiness: data } : {}),
      });
      console.log(key, route, response.status);
      if (route === '/api/auth/login' && !response.ok) throw Error('Login failed');
    }
    try {
      await request('/api/auth/login', { email: accounts[key + '_EMAIL'], password: accounts[key + '_PASSWORD'] });
      for (const route of ['/api/auth/me', '/api/workflows', '/api/network', '/api/agreements', '/api/orders', '/api/network/distributors', '/api/members/requests']) await request(route);
    } finally { if (cookie) await request('/api/auth/refresh/logout', {}); }
    results.push({ account: key, checks });
  }
  fs.writeFileSync(path.join(__dirname, 'pre-order-flow.json'), JSON.stringify({ database: 'arcadelx_local', businessWrites: false, results }, null, 2));
}
main().catch(e => { console.error(e.name, e.message); process.exitCode = 1; });
