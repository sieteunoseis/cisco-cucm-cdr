const express = require("express");
const { selectLogFiles } = require("cisco-dime");
const config = require("../../config");

function findClusterConfig(clusterId) {
  if (!config.axl.clusters || !config.axl.clusters.length || !clusterId) {
    return null;
  }
  return config.axl.clusters.find((c) => c.clusterId === clusterId) || null;
}

function createLogsRouter(pool) {
  const router = express.Router();

  // POST /api/v1/cdr/logs/collect
  // Body: { callId, callManagerId? }
  // Selects SDL/SDI trace files from CUCM for the given call's time window
  router.post("/collect", async (req, res) => {
    const { callId, callManagerId } = req.body;
    if (!callId) {
      return res.status(400).json({ error: "callId is required" });
    }

    try {
      // Look up CDR to get cluster and time window
      const conditions = ["globalcallid_callid = $1"];
      const values = [callId];
      if (callManagerId) {
        conditions.push("globalcallid_callmanagerid = $2");
        values.push(callManagerId);
      }

      const cdrResult = await pool.query(
        `SELECT globalcallid_clusterid, datetimeorigination, datetimedisconnect
         FROM cdr WHERE ${conditions.join(" AND ")}
         ORDER BY datetimeorigination ASC`,
        values,
      );

      if (cdrResult.rows.length === 0) {
        return res.status(404).json({ error: "No CDR found for this call" });
      }

      // Get time window with 30s buffer on each side
      const origTimes = cdrResult.rows
        .map((r) => new Date(r.datetimeorigination).getTime())
        .filter(Boolean);
      const discTimes = cdrResult.rows
        .map((r) => new Date(r.datetimedisconnect).getTime())
        .filter(Boolean);

      if (!origTimes.length || !discTimes.length) {
        return res.status(400).json({ error: "CDR missing timestamps" });
      }

      const fromDate = new Date(Math.min(...origTimes) - 30000).toISOString();
      const toDate = new Date(Math.max(...discTimes) + 30000).toISOString();
      const clusterId = cdrResult.rows[0].globalcallid_clusterid;

      // Find matching cluster config
      const clusterConfig = findClusterConfig(clusterId);
      if (!clusterConfig) {
        return res.status(400).json({
          error: `No AXL/DIME config for cluster "${clusterId}"`,
          cluster: clusterId,
        });
      }

      // Select log files from CUCM via DIME
      const logs = await selectLogFiles(
        clusterConfig.host,
        clusterConfig.username,
        clusterConfig.password,
        "Cisco CallManager",
        fromDate,
        toDate,
        "America/Los_Angeles",
      );

      res.json({
        cluster: clusterId,
        host: clusterConfig.host,
        timeWindow: { from: fromDate, to: toDate },
        files: logs.map((f) => ({
          name: f.name,
          path: f.absolutepath,
          size: f.filesize,
          modified: f.modifiedDate,
          server: f.server,
        })),
        count: logs.length,
      });
    } catch (err) {
      console.error("Log collection failed:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createLogsRouter };
