const { getCache, setCache } = require("./cache");

async function enrichCdrRecords(pool, records, axlConfig) {
  if (!axlConfig || !axlConfig.host) {
    return records; // AXL not configured, skip enrichment
  }

  // TODO: Implement AXL lookups via cisco-axl library
  // For now, return records unmodified
  // Future: batch lookup unique device names and DNs, cache results
  console.log("AXL enrichment: skipped (not yet implemented)");
  return records;
}

module.exports = { enrichCdrRecords };
