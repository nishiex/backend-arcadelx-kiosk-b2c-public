import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

export async function run(c: any) {
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  for (const type of ['COMPANY', 'DISTRIBUTOR', 'PARTNER']) {
    const actor = await c.fixture(`logout-${type.toLowerCase()}`, type);
    const token = actor.cookie.split('; ').find((item: string) => item.startsWith('refresh_token='))!.slice('refresh_token='.length);
    const otherSession = randomUUID();
    await c.prisma.refreshToken.create({ data: { userId: actor.userId, token: hash(otherSession), expiresAt: new Date(Date.now() + 60000) } });
    const response = await c.http(`logout-${type}-session`, actor, 'POST', '/api/auth/refresh/logout', undefined, 200);
    assert.equal(response.status, 200);
    c.check(`logout-${type}-clears-cookies`, response.cookies === 'access_token=; refresh_token=');
    c.check(`logout-${type}-revokes-only-current-refresh`, await c.prisma.refreshToken.count({ where: { token: hash(token) } }) === 0 && await c.prisma.refreshToken.count({ where: { token: hash(otherSession) } }) === 1);
    await c.http(`logout-${type}-refresh-replay-denied`, { ...actor, cookie: `refresh_token=${token}` }, 'POST', '/api/auth/refresh', undefined, 401);
  }
  const inactive = await c.fixture('logout-inactive', 'DISTRIBUTOR', undefined, 'STAFF', 'PENDING');
  const refreshCookie = inactive.cookie.split('; ').find((item: string) => item.startsWith('refresh_token='));
  const invalidAccess = { ...inactive, cookie: `access_token=expired-or-invalid; ${refreshCookie}` };
  await c.http('logout-inactive-expired-access', invalidAccess, 'POST', '/api/auth/refresh/logout', undefined, 200);
  c.check('logout-inactive-session-revoked', await c.prisma.refreshToken.count({ where: { userId: inactive.userId } }) === 0);
  const remaining = await c.prisma.refreshToken.count();
  for (const [label, actor] of [['anonymous', null], ['invalid-cookie', { cookie: 'access_token=invalid; refresh_token=invalid' }], ['repeated', null]] as const) {
    await c.http(`logout-${label}`, actor, 'POST', '/api/auth/refresh/logout', undefined, 200);
  }
  c.check('logout-idempotent-preserves-other-sessions', await c.prisma.refreshToken.count() === remaining);
}
