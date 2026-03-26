function parseAxlClusters() {
  const clusters = [];
  for (let i = 1; i <= 5; i++) {
    const host = process.env[`AXL_HOST_${i}`];
    if (!host) continue;
    clusters.push({
      host,
      username: process.env[`AXL_USERNAME_${i}`] || "",
      password: process.env[`AXL_PASSWORD_${i}`] || "",
      version: process.env[`AXL_VERSION_${i}`] || "15.0",
      clusterId: process.env[`AXL_CLUSTER_ID_${i}`] || "",
    });
  }
  return clusters;
}

const config = {
  database: {
    url:
      process.env.DATABASE_URL ||
      "postgresql://cdr:cdr_password@localhost:5432/callmanager",
  },
  axl: {
    clusters: parseAxlClusters(),
    cacheTtl: parseInt(process.env.AXL_CACHE_TTL || "86400", 10),
  },
  cdr: {
    incomingDir: process.env.CDR_INCOMING_DIR || "/data/incoming",
    retentionDays: parseInt(process.env.CDR_RETENTION_DAYS || "90", 10),
  },
  server: {
    port: parseInt(process.env.MCP_PORT || "3000", 10),
  },
  logLevel: process.env.LOG_LEVEL || "info",
};

module.exports = config;
