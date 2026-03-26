const chokidar = require("chokidar");
const fs = require("fs");
const path = require("path");
const config = require("../config");
const { parseFilename } = require("./file-parser");
const { parseCdrFile } = require("../parser/cdr-parser");
const { parseCmrFile } = require("../parser/cmr-parser");

function startWatcher(pool, opts = {}) {
  const dir = opts.incomingDir || config.cdr.incomingDir;
  console.log(`File watcher: watching ${dir}`);

  const watcher = chokidar.watch(dir, {
    persistent: true,
    ignoreInitial: false, // Process existing files on startup
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100,
    },
  });

  watcher.on("add", async (filePath) => {
    await processFile(pool, filePath, opts);
  });

  watcher.on("error", (err) => {
    console.error("File watcher error:", err.message);
  });

  return watcher;
}

async function processFile(pool, filePath, opts = {}) {
  const fileInfo = parseFilename(filePath);
  if (!fileInfo) return; // Not a CDR/CMR file, skip silently

  const filename = path.basename(filePath);
  const startTime = Date.now();

  try {
    // Check dedup — skip if already processed
    const existing = await pool.query(
      "SELECT filename FROM file_processing_log WHERE filename = $1",
      [filename],
    );
    if (existing.rows.length > 0) {
      console.log(`Skipping already processed: ${filename}`);
      return;
    }

    // Parse CSV
    let records;
    if (fileInfo.type === "cdr") {
      records = await parseCdrFile(filePath);
    } else {
      records = await parseCmrFile(filePath);
    }

    // NOTE: AXL enrichment will be wired in here later (Task 12)
    // if (fileInfo.type === 'cdr') {
    //   records = await enrichCdrRecords(pool, records, config.axl);
    // }

    // Insert records (writers will be implemented in Task 6)
    let recordsInserted = 0;
    if (opts.cdrWriter && fileInfo.type === "cdr") {
      recordsInserted = await opts.cdrWriter(pool, records);
    } else if (opts.cmrWriter && fileInfo.type === "cmr") {
      recordsInserted = await opts.cmrWriter(pool, records);
    } else {
      recordsInserted = records.length;
    }

    // Log success
    const processingTime = Date.now() - startTime;
    await pool.query(
      `INSERT INTO file_processing_log (filename, file_type, cluster, node, file_date, sequence, records_inserted, processed_at, processing_time_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8)`,
      [
        filename,
        fileInfo.type,
        fileInfo.cluster,
        fileInfo.node,
        fileInfo.date,
        fileInfo.sequence,
        recordsInserted,
        processingTime,
      ],
    );

    // Delete processed file
    fs.unlinkSync(filePath);
    console.log(
      `Processed ${filename}: ${recordsInserted} records in ${processingTime}ms`,
    );
  } catch (err) {
    const processingTime = Date.now() - startTime;
    console.error(`Error processing ${filename}:`, err.message);

    // Log error
    try {
      await pool.query(
        `INSERT INTO file_processing_log (filename, file_type, cluster, node, file_date, sequence, records_inserted, processed_at, processing_time_ms, error)
         VALUES ($1, $2, $3, $4, $5, $6, 0, now(), $7, $8)
         ON CONFLICT (filename) DO NOTHING`,
        [
          filename,
          fileInfo.type,
          fileInfo.cluster,
          fileInfo.node,
          fileInfo.date,
          fileInfo.sequence,
          processingTime,
          err.message,
        ],
      );
    } catch (logErr) {
      console.error("Failed to log error:", logErr.message);
    }
  }
}

module.exports = { startWatcher, processFile };
