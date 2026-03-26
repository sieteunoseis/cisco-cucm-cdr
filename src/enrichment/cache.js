async function getCache(pool, key) {
  const result = await pool.query(
    "SELECT data FROM enrichment_cache WHERE cache_key = $1 AND expires_at > now()",
    [key],
  );
  return result.rows.length ? result.rows[0].data : null;
}

async function setCache(pool, key, type, data, ttlSeconds = 3600) {
  await pool.query(
    `INSERT INTO enrichment_cache (cache_key, cache_type, data, fetched_at, expires_at)
     VALUES ($1, $2, $3, now(), now() + $4 * interval '1 second')
     ON CONFLICT (cache_key) DO UPDATE SET data = $3, fetched_at = now(), expires_at = now() + $4 * interval '1 second'`,
    [key, type, JSON.stringify(data), ttlSeconds],
  );
}

async function clearExpired(pool) {
  await pool.query("DELETE FROM enrichment_cache WHERE expires_at < now()");
}

module.exports = { getCache, setCache, clearExpired };
