const axlService = require("cisco-axl");
const { getCache, setCache } = require("./cache");

// CUCM device names are alphanumeric (SEPxxxx, CSFxxxx, etc.)
const DEVICE_NAME_RE = /^[A-Za-z0-9_\-.]+$/;

const AXL_DEVICE_SQL = `
  SELECT d.name, d.description, dp.name AS devicepool,
         loc.name AS location, eu.userid
  FROM device d
  LEFT JOIN devicepool dp ON d.fkdevicepool = dp.pkid
  LEFT JOIN location loc ON dp.fklocation = loc.pkid
  LEFT JOIN enduser eu ON d.fkenduser = eu.pkid
  WHERE d.name IN (%PLACEHOLDERS%)
`;

function findClusterConfig(clusters, clusterid) {
  if (!clusters || !clusters.length || !clusterid) return null;
  return clusters.find((c) => c.clusterId === clusterid) || null;
}

function collectDeviceNames(records) {
  const names = new Set();
  for (const r of records) {
    if (r.origdevicename) names.add(r.origdevicename);
    if (r.destdevicename) names.add(r.destdevicename);
  }
  return names;
}

function mapEnrichmentToRecords(records, deviceMap) {
  const now = new Date();
  return records.map((r) => {
    const enriched = { ...r };
    const orig = deviceMap.get(r.origdevicename);
    if (orig) {
      enriched.orig_device_description = orig.description;
      enriched.orig_device_user = orig.userid;
      enriched.orig_device_pool = orig.devicepool;
      enriched.orig_device_location = orig.location;
    }
    const dest = deviceMap.get(r.destdevicename);
    if (dest) {
      enriched.dest_device_description = dest.description;
      enriched.dest_device_user = dest.userid;
      enriched.dest_device_pool = dest.devicepool;
      enriched.dest_device_location = dest.location;
    }
    if (orig || dest) {
      enriched.enriched_at = now;
    }
    return enriched;
  });
}

async function lookupDevices(clusterConfig, deviceNames) {
  const service = new axlService(
    clusterConfig.host,
    clusterConfig.username,
    clusterConfig.password,
    clusterConfig.version,
  );
  const safeNames = deviceNames.filter((n) => DEVICE_NAME_RE.test(n));
  if (safeNames.length === 0) return new Map();
  const quoted = safeNames.map((n) => `'${n}'`).join(",");
  const sql = AXL_DEVICE_SQL.replace("%PLACEHOLDERS%", quoted);
  const rows = await service.executeSqlQuery(sql);
  const results = new Map();
  if (Array.isArray(rows)) {
    for (const row of rows) {
      results.set(row.name, {
        description: row.description || null,
        userid: row.userid || null,
        devicepool: row.devicepool || null,
        location: row.location || null,
      });
    }
  }
  return results;
}

async function resolveDevices(pool, clusterConfig, deviceNames, cacheTtl) {
  const deviceMap = new Map();
  const uncached = [];

  for (const name of deviceNames) {
    const cacheKey = `device:${clusterConfig.clusterId}:${name}`;
    const cached = await getCache(pool, cacheKey);
    if (cached) {
      deviceMap.set(
        name,
        typeof cached === "string" ? JSON.parse(cached) : cached,
      );
    } else {
      uncached.push(name);
    }
  }

  if (uncached.length > 0) {
    const looked = await lookupDevices(clusterConfig, uncached);
    for (const [name, data] of looked) {
      deviceMap.set(name, data);
      const cacheKey = `device:${clusterConfig.clusterId}:${name}`;
      await setCache(pool, cacheKey, "device", data, cacheTtl);
    }
    for (const name of uncached) {
      if (!looked.has(name)) {
        const empty = {
          description: null,
          userid: null,
          devicepool: null,
          location: null,
        };
        const cacheKey = `device:${clusterConfig.clusterId}:${name}`;
        await setCache(pool, cacheKey, "device", empty, cacheTtl);
      }
    }
  }

  return deviceMap;
}

async function enrichCdrRecords(pool, records, axlConfig) {
  if (!axlConfig || !axlConfig.clusters || !axlConfig.clusters.length) {
    return records;
  }
  if (!records || records.length === 0) return records;

  // CDR files are per-cluster, so all records share the same clusterid
  const clusterId = records[0].globalcallid_clusterid;
  const clusterConfig = findClusterConfig(axlConfig.clusters, clusterId);
  if (!clusterConfig) {
    console.log(
      `AXL enrichment: no config for cluster "${clusterId}", skipping`,
    );
    return records;
  }

  const deviceNames = collectDeviceNames(records);
  if (deviceNames.size === 0) return records;

  try {
    const cacheTtl = axlConfig.cacheTtl || 86400;
    const deviceMap = await resolveDevices(
      pool,
      clusterConfig,
      deviceNames,
      cacheTtl,
    );
    console.log(
      `AXL enrichment: ${deviceMap.size} devices resolved for cluster "${clusterId}" (${deviceNames.size} unique)`,
    );
    return mapEnrichmentToRecords(records, deviceMap);
  } catch (err) {
    console.warn(
      `AXL enrichment failed for cluster "${clusterId}": ${err.message}`,
    );
    return records;
  }
}

module.exports = {
  enrichCdrRecords,
  findClusterConfig,
  collectDeviceNames,
  mapEnrichmentToRecords,
  lookupDevices,
  resolveDevices,
};
