export function revenueRedisOptions() {
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required for revenue jobs');
  const url = new URL(process.env.REDIS_URL);
  if (!['redis:', 'rediss:'].includes(url.protocol)) throw new Error('Invalid REDIS_URL protocol');
  return {
    host: url.hostname, port: Number(url.port || 6379),
    username: decodeURIComponent(url.username) || undefined,
    password: decodeURIComponent(url.password) || undefined,
    db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}), maxRetriesPerRequest: null,
  };
}
