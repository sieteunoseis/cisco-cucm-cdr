const CMR_COLUMNS = [
  "cdrrecordtype",
  "globalcallid_callmanagerid",
  "globalcallid_callid",
  "nodeid",
  "directorynum",
  "callidentifier",
  "datetimestamp",
  "numberpacketssent",
  "numberoctetssent",
  "numberpacketsreceived",
  "numberoctetsreceived",
  "numberpacketslost",
  "jitter",
  "latency",
  "pkid",
  "directorynumpartition",
  "globalcallid_clusterid",
  "devicename",
  "moslqk",
  "moslqkavg",
  "moslqkmin",
  "moslqkmax",
  "intervalconcealratio",
  "cumulativeconcealratio",
  "intervalconcealratiomax",
  "concealsecs",
  "severelyconcealsecs",
  // CUCM 14/15 additional columns
  "duration",
  "videocontenttype",
  "videoduration",
  "numbervideopacketssent",
  "numbervideooctetssent",
  "numbervideopacketsreceived",
  "numbervideooctetsreceived",
  "numbervideopacketslost",
  "videoaveragejitter",
  "videoroundtriptime",
  "videoonewaydelay",
  "videoreceptionmetrics",
  "videotransmissionmetrics",
  "videocontenttype_channel2",
  "videoduration_channel2",
  "numbervideopacketssent_channel2",
  "numbervideooctetssent_channel2",
  "numbervideopacketsreceived_channel2",
  "numbervideooctetsreceived_channel2",
  "numbervideopacketslost_channel2",
  "videoaveragejitter_channel2",
  "videoroundtriptime_channel2",
  "videoonewaydelay_channel2",
  "videoreceptionmetrics_channel2",
  "videotransmissionmetrics_channel2",
  "localsessionid",
  "remotesessionid",
  "headsetsn",
  "headsetmetrics",
];

async function insertCmrRecords(pool, records) {
  let inserted = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const record of records) {
      const placeholders = CMR_COLUMNS.map((_, i) => `$${i + 1}`).join(", ");
      const values = CMR_COLUMNS.map((col) => record[col] ?? null);

      const result = await client.query(
        `INSERT INTO cmr (${CMR_COLUMNS.join(", ")})
         SELECT ${placeholders}
         WHERE NOT EXISTS (SELECT 1 FROM cmr WHERE pkid = $${CMR_COLUMNS.indexOf("pkid") + 1})`,
        values,
      );
      inserted += result.rowCount;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return inserted;
}

module.exports = { insertCmrRecords, CMR_COLUMNS };
