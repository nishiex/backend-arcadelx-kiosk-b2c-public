export function revenueRedisOptions() {
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required for revenue jobs');
  const url = new URL(process.env.REDIS_URL);
  if (!['redis:', 'rediss:'].includes(url.protocol)) throw new Error('Invalid REDIS_URL protocol');
  return {
    host: url.hostname, port: Number(url.port || 6379),
    username: decodeURIComponent(url.username) || undefined,
    password: decodeURIComponent(url.password) || undefined,
    db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    // Do not let an HTTP request wait indefinitely when Redis is unavailable.
    // Workers may retry reconnecting, but queue commands must fail promptly so the
    // API can return an actionable error instead of a browser timeout.
    connectTimeout: 5000,
    enableOfflineQueue: false,
    maxRetriesPerRequest: null,
  };
}
