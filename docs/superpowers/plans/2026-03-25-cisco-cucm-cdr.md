# cisco-cucm-cdr Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Dockerized Node.js CDR/CMR processor that ingests CUCM files, enriches via AXL, stores in PostgreSQL, and exposes MCP + REST APIs.

**Architecture:** File watcher detects CDR/CMR CSVs in a mounted volume, parses them with type conversion, enriches via cisco-axl lookups (cached in Postgres), inserts into the existing C# app schema, then serves queries through an MCP streamable HTTP server and Express REST API.

**Tech Stack:** Node.js 20, PostgreSQL 16, Express, @modelcontextprotocol/sdk, csv-parse, chokidar, pg, cisco-axl, Docker

**Spec:** `docs/superpowers/specs/2026-03-25-cisco-cucm-cdr-design.md`

**Reference C# app:** `/Users/wordenj/Downloads/callmanagercdrcollector-master@3d491d660b4/`

---

### Task 1: Project Scaffolding

**Files:**

- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/config.js`

- [ ] **Step 1: Initialize npm project**

```bash
cd /Users/wordenj/Developer/cisco-cucm-cdr
npm init -y
```

Edit `package.json`:

```json
{
  "name": "cisco-cucm-cdr",
  "version": "0.1.0",
  "description": "CUCM CDR/CMR processor with AXL enrichment, MCP server, and REST API",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js",
    "test": "node --test test/**/*.test.js"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "license": "MIT"
}
```

- [ ] **Step 2: Create .gitignore**

```
node_modules/
.env
data/
*.log
```

- [ ] **Step 3: Create .env.example**

```
DATABASE_URL=postgresql://cdr:cdr_password@localhost:5432/callmanager
AXL_HOST=cucm.example.com
AXL_USERNAME=axl-user
AXL_PASSWORD=axl-password
AXL_VERSION=15.0
CDR_INCOMING_DIR=/data/incoming
CDR_RETENTION_DAYS=90
MCP_PORT=3000
LOG_LEVEL=info
```

- [ ] **Step 4: Create config.js**

Create `src/config.js`:

```js
const config = {
  database: {
    url:
      process.env.DATABASE_URL ||
      "postgresql://cdr:cdr_password@localhost:5432/callmanager",
  },
  axl: {
    host: process.env.AXL_HOST,
    username: process.env.AXL_USERNAME,
    password: process.env.AXL_PASSWORD,
    version: process.env.AXL_VERSION || "15.0",
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
```

- [ ] **Step 5: Install core dependencies**

```bash
npm install pg csv-parse chokidar express uuid node-cron cisco-axl @modelcontextprotocol/sdk
```

- [ ] **Step 6: Commit**

```bash
git init
git add package.json package-lock.json .gitignore .env.example src/config.js
git commit -m "feat: scaffold cisco-cucm-cdr project"
```

---

### Task 2: SQL Schema Files

Copy the canonical SQL from the C# app and create the migration file.

**Files:**

- Create: `sql/CreateSchema.sql` (copy from C# app)
- Create: `sql/PopulateSchema.sql` (copy from C# app)
- Create: `sql/Migration001_enrichment.sql`

- [ ] **Step 1: Copy original SQL files**

```bash
cp /Users/wordenj/Downloads/callmanagercdrcollector-master@3d491d660b4/CallManagerCDRCollector/Database/SQL/CreateSchema.sql sql/CreateSchema.sql
cp /Users/wordenj/Downloads/callmanagercdrcollector-master@3d491d660b4/CallManagerCDRCollector/Database/SQL/PopulateSchema.sql sql/PopulateSchema.sql
```

- [ ] **Step 2: Create Migration001_enrichment.sql**

Create `sql/Migration001_enrichment.sql`:

```sql
-- Migration 001: Add enrichment columns, new tables, and indexes
-- Idempotent — safe to run on every startup

-- Enrichment columns on cdr table
ALTER TABLE cdr ADD COLUMN IF NOT EXISTS orig_device_description text;
ALTER TABLE cdr ADD COLUMN IF NOT EXISTS orig_device_user text;
ALTER TABLE cdr ADD COLUMN IF NOT EXISTS orig_device_pool text;
ALTER TABLE cdr ADD COLUMN IF NOT EXISTS orig_device_location text;
ALTER TABLE cdr ADD COLUMN IF NOT EXISTS dest_device_description text;
ALTER TABLE cdr ADD COLUMN IF NOT EXISTS dest_device_user text;
ALTER TABLE cdr ADD COLUMN IF NOT EXISTS dest_device_pool text;
ALTER TABLE cdr ADD COLUMN IF NOT EXISTS dest_device_location text;
ALTER TABLE cdr ADD COLUMN IF NOT EXISTS calling_party_user text;
ALTER TABLE cdr ADD COLUMN IF NOT EXISTS called_party_user text;
ALTER TABLE cdr ADD COLUMN IF NOT EXISTS route_pattern_matched text;
ALTER TABLE cdr ADD COLUMN IF NOT EXISTS enriched_at timestamp;

-- Enrichment cache table
CREATE TABLE IF NOT EXISTS enrichment_cache (
    cache_key text PRIMARY KEY,
    cache_type text NOT NULL,
    data jsonb NOT NULL,
    fetched_at timestamp NOT NULL,
    expires_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_enrichment_cache_type ON enrichment_cache(cache_type);
CREATE INDEX IF NOT EXISTS idx_enrichment_cache_expires ON enrichment_cache(expires_at);

-- File processing log
CREATE TABLE IF NOT EXISTS file_processing_log (
    filename text PRIMARY KEY,
    file_type text NOT NULL,
    cluster text,
    node text,
    file_date text,
    sequence text,
    records_inserted integer,
    processed_at timestamp NOT NULL,
    processing_time_ms integer,
    error text
);

-- Performance indexes on cdr
CREATE INDEX IF NOT EXISTS idx_cdr_datetimeorigination ON cdr(datetimeorigination);
CREATE INDEX IF NOT EXISTS idx_cdr_callingpartynumber ON cdr(callingpartynumber);
CREATE INDEX IF NOT EXISTS idx_cdr_finalcalledpartynumber ON cdr(finalcalledpartynumber);
CREATE INDEX IF NOT EXISTS idx_cdr_origdevicename ON cdr(origdevicename);
CREATE INDEX IF NOT EXISTS idx_cdr_destdevicename ON cdr(destdevicename);
CREATE INDEX IF NOT EXISTS idx_cdr_globalcallid ON cdr(globalcallid_callmanagerid, globalcallid_callid);
CREATE INDEX IF NOT EXISTS idx_cdr_origcause_value ON cdr(origcause_value);
CREATE INDEX IF NOT EXISTS idx_cdr_destcause_value ON cdr(destcause_value);

-- Performance indexes on cmr
CREATE INDEX IF NOT EXISTS idx_cmr_globalcallid ON cmr(globalcallid_callmanagerid, globalcallid_callid);
CREATE INDEX IF NOT EXISTS idx_cmr_devicename ON cmr(devicename);
CREATE INDEX IF NOT EXISTS idx_cmr_datetimestamp ON cmr(datetimestamp);
```

- [ ] **Step 3: Commit**

```bash
git add sql/
git commit -m "feat: add SQL schema files (original + enrichment migration)"
```

---

### Task 3: Database Pool + Auto-Schema

**Files:**

- Create: `src/database/pool.js`
- Create: `src/database/schema.js`
- Test: `test/database/schema.test.js`

- [ ] **Step 1: Write pool.js**

Create `src/database/pool.js`:

```js
const { Pool } = require("pg");
const config = require("../config");

const pool = new Pool({ connectionString: config.database.url });

pool.on("error", (err) => {
  console.error("Unexpected Postgres pool error:", err.message);
});

module.exports = pool;
```

- [ ] **Step 2: Write schema.js**

Create `src/database/schema.js`:

```js
const fs = require("fs");
const path = require("path");

const SQL_DIR = path.join(__dirname, "../../sql");

async function tableExists(pool, tableName) {
  const result = await pool.query(
    `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
    [tableName],
  );
  return result.rows[0].exists;
}

async function initSchema(pool) {
  const cdrExists = await tableExists(pool, "cdr");

  if (!cdrExists) {
    console.log("Fresh install — creating schema...");
    const createSql = fs.readFileSync(
      path.join(SQL_DIR, "CreateSchema.sql"),
      "utf8",
    );
    await pool.query(createSql);
    console.log("Schema created.");

    const populateSql = fs.readFileSync(
      path.join(SQL_DIR, "PopulateSchema.sql"),
      "utf8",
    );
    await pool.query(populateSql);
    console.log("Lookup tables populated.");
  } else {
    console.log("Existing database detected.");
  }

  // Always run migrations (idempotent)
  const migrationSql = fs.readFileSync(
    path.join(SQL_DIR, "Migration001_enrichment.sql"),
    "utf8",
  );
  await pool.query(migrationSql);
  console.log("Migrations applied.");
}

module.exports = { initSchema, tableExists };
```

- [ ] **Step 3: Write test for schema init**

Create `test/database/schema.test.js`:

```js
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const { initSchema, tableExists } = require("../../src/database/schema");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://cdr:cdr_password@localhost:5432/callmanager_test";

describe("schema init", () => {
  let pool;

  before(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL });
    // Drop all tables to test fresh install
    await pool.query(
      "DROP TABLE IF EXISTS cdr, cmr, cdr_cause, cdr_codec, cdr_onbehalfof, cdr_reason, enrichment_cache, file_processing_log CASCADE",
    );
  });

  after(async () => {
    await pool.end();
  });

  it("creates schema on fresh database", async () => {
    await initSchema(pool);
    assert.strictEqual(await tableExists(pool, "cdr"), true);
    assert.strictEqual(await tableExists(pool, "cmr"), true);
    assert.strictEqual(await tableExists(pool, "cdr_cause"), true);
    assert.strictEqual(await tableExists(pool, "enrichment_cache"), true);
    assert.strictEqual(await tableExists(pool, "file_processing_log"), true);
  });

  it("is idempotent — runs again without error", async () => {
    await initSchema(pool);
    assert.strictEqual(await tableExists(pool, "cdr"), true);
  });

  it("has enrichment columns on cdr", async () => {
    const result = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'cdr' AND column_name = 'orig_device_description'`,
    );
    assert.strictEqual(result.rows.length, 1);
  });

  it("has lookup data populated", async () => {
    const result = await pool.query("SELECT count(*) FROM cdr_cause");
    assert.ok(parseInt(result.rows[0].count) > 100);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
npm test -- test/database/schema.test.js
```

Expected: All 4 tests pass (requires a running test Postgres).

- [ ] **Step 5: Commit**

```bash
git add src/database/ test/database/
git commit -m "feat: database pool and auto-schema initialization"
```

---

### Task 4: Type Converters

**Files:**

- Create: `src/parser/type-converters.js`
- Test: `test/parser/type-converters.test.js`

- [ ] **Step 1: Write the tests**

Create `test/parser/type-converters.test.js`:

```js
const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  epochToDate,
  epochToDateNullable,
  intToIp,
  stringToIp,
  secondsToInterval,
  emptyToNull,
  parseVarVQMetrics,
} = require("../../src/parser/type-converters");

describe("epochToDate", () => {
  it("converts Unix epoch seconds to Date", () => {
    const date = epochToDate(1711382504);
    assert.ok(date instanceof Date);
    assert.strictEqual(date.toISOString(), "2024-03-25T17:01:44.000Z");
  });
});

describe("epochToDateNullable", () => {
  it("returns null for 0", () => {
    assert.strictEqual(epochToDateNullable(0), null);
  });
  it("returns null for empty string", () => {
    assert.strictEqual(epochToDateNullable(""), null);
  });
  it("converts valid epoch", () => {
    const date = epochToDateNullable(1711382504);
    assert.ok(date instanceof Date);
  });
});

describe("intToIp", () => {
  it("converts integer to IPv4 string", () => {
    // 167772161 = 10.0.0.1
    assert.strictEqual(intToIp(167772161), "10.0.0.1");
  });
  it("returns null for 0", () => {
    assert.strictEqual(intToIp(0), null);
  });
});

describe("stringToIp", () => {
  it("returns IPv4 as-is", () => {
    assert.strictEqual(stringToIp("10.0.0.1"), "10.0.0.1");
  });
  it("returns null for empty string", () => {
    assert.strictEqual(stringToIp(""), null);
  });
});

describe("secondsToInterval", () => {
  it("converts seconds to PG interval string", () => {
    assert.strictEqual(secondsToInterval(125), "125 seconds");
  });
  it("returns null for 0", () => {
    assert.strictEqual(secondsToInterval(0), null);
  });
});

describe("emptyToNull", () => {
  it("returns null for empty string", () => {
    assert.strictEqual(emptyToNull(""), null);
  });
  it("passes through non-empty string", () => {
    assert.strictEqual(emptyToNull("hello"), "hello");
  });
});

describe("parseVarVQMetrics", () => {
  it("parses semicolon-delimited key=value pairs", () => {
    const result = parseVarVQMetrics("MLQK=3.5;MLQKav=3.4;ICR=0.005");
    assert.deepStrictEqual(result, { MLQK: 3.5, MLQKav: 3.4, ICR: 0.005 });
  });
  it("returns empty object for empty string", () => {
    assert.deepStrictEqual(parseVarVQMetrics(""), {});
  });
  it("returns empty object for null", () => {
    assert.deepStrictEqual(parseVarVQMetrics(null), {});
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- test/parser/type-converters.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write type-converters.js**

Create `src/parser/type-converters.js`:

```js
function epochToDate(epoch) {
  return new Date(Number(epoch) * 1000);
}

function epochToDateNullable(epoch) {
  const val = Number(epoch);
  if (!val || val === 0) return null;
  return new Date(val * 1000);
}

function intToIp(num) {
  const val = Number(num);
  if (!val || val === 0) return null;
  return [
    (val >>> 24) & 0xff,
    (val >>> 16) & 0xff,
    (val >>> 8) & 0xff,
    val & 0xff,
  ].join(".");
}

function stringToIp(str) {
  if (!str || str.trim() === "") return null;
  return str.trim();
}

function secondsToInterval(seconds) {
  const val = Number(seconds);
  if (!val || val === 0) return null;
  return `${val} seconds`;
}

function emptyToNull(str) {
  if (str === "" || str === null || str === undefined) return null;
  return str;
}

function parseVarVQMetrics(str) {
  if (!str || str.trim() === "") return {};
  const result = {};
  for (const pair of str.split(";")) {
    const [key, value] = pair.split("=");
    if (key && value !== undefined) {
      result[key.trim()] = parseFloat(value);
    }
  }
  return result;
}

module.exports = {
  epochToDate,
  epochToDateNullable,
  intToIp,
  stringToIp,
  secondsToInterval,
  emptyToNull,
  parseVarVQMetrics,
};
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- test/parser/type-converters.test.js
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parser/type-converters.js test/parser/type-converters.test.js
git commit -m "feat: type converters for CDR/CMR field parsing"
```

---

### Task 5: CDR + CMR CSV Parsers

**Files:**

- Create: `src/parser/cdr-parser.js`
- Create: `src/parser/cmr-parser.js`
- Create: `test/fixtures/sample_cdr.txt`
- Create: `test/fixtures/sample_cmr.txt`
- Test: `test/parser/cdr-parser.test.js`
- Test: `test/parser/cmr-parser.test.js`

- [ ] **Step 1: Create test fixtures**

Create `test/fixtures/sample_cdr.txt` — a minimal CDR CSV with the type-definition header row and one data row. Use the exact 115 columns from the C# app's `InsertCDR.sql`. The first row is column types (integers, strings), the second row is actual data.

Create `test/fixtures/sample_cmr.txt` — a minimal CMR CSV with VarVQMetrics. The first row is column types, second row is actual data with a VarVQMetrics field like `MLQK=3.5;MLQKav=3.4;MLQKmn=2.1;MLQKmx=4.0;ICR=0.005;CCR=0.01;ICRmx=0.02;CS=0.5;SCS=0.0`.

Note: CDR CSV column order matches the `InsertCDR.sql` parameter order. CDR files have 115 comma-separated fields. CMR files have the standard fields plus a `varVQMetrics` column at the end.

Reference the C# `CDRRecord.cs` and `CMRRecord.cs` for exact field order and the `CDRRecordClassMap` / `CMRRecordClassMap` for CSV column mappings.

- [ ] **Step 2: Write cdr-parser tests**

Create `test/parser/cdr-parser.test.js`:

```js
const { describe, it } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { parseCdrFile } = require("../../src/parser/cdr-parser");

describe("CDR parser", () => {
  it("parses a CDR CSV file skipping the type-definition header", async () => {
    const records = await parseCdrFile(
      path.join(__dirname, "../fixtures/sample_cdr.txt"),
    );
    assert.strictEqual(records.length, 1);
  });

  it("converts epoch timestamps to Date objects", async () => {
    const records = await parseCdrFile(
      path.join(__dirname, "../fixtures/sample_cdr.txt"),
    );
    const record = records[0];
    assert.ok(record.datetimeorigination instanceof Date);
  });

  it("converts integer IPs to string format", async () => {
    const records = await parseCdrFile(
      path.join(__dirname, "../fixtures/sample_cdr.txt"),
    );
    const record = records[0];
    // origipaddr should be converted from int or left as string IP
    assert.ok(
      record.origipaddr === null || typeof record.origipaddr === "string",
    );
  });

  it("generates a UUID pkid", async () => {
    const records = await parseCdrFile(
      path.join(__dirname, "../fixtures/sample_cdr.txt"),
    );
    const record = records[0];
    assert.ok(record.pkid);
    assert.match(record.pkid, /^[0-9a-f-]{36}$/);
  });

  it("computes duration as interval string", async () => {
    const records = await parseCdrFile(
      path.join(__dirname, "../fixtures/sample_cdr.txt"),
    );
    const record = records[0];
    // duration is derived from connect/disconnect times or raw seconds
    assert.ok(record.duration === null || typeof record.duration === "string");
  });
});
```

- [ ] **Step 3: Write cmr-parser tests**

Create `test/parser/cmr-parser.test.js`:

```js
const { describe, it } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { parseCmrFile } = require("../../src/parser/cmr-parser");

describe("CMR parser", () => {
  it("parses a CMR CSV file", async () => {
    const records = await parseCmrFile(
      path.join(__dirname, "../fixtures/sample_cmr.txt"),
    );
    assert.strictEqual(records.length, 1);
  });

  it("extracts MOS-LQK from VarVQMetrics", async () => {
    const records = await parseCmrFile(
      path.join(__dirname, "../fixtures/sample_cmr.txt"),
    );
    const record = records[0];
    assert.strictEqual(typeof record.moslqk, "number");
    assert.strictEqual(typeof record.moslqkavg, "number");
  });

  it("generates a UUID pkid", async () => {
    const records = await parseCmrFile(
      path.join(__dirname, "../fixtures/sample_cmr.txt"),
    );
    assert.match(records[0].pkid, /^[0-9a-f-]{36}$/);
  });
});
```

- [ ] **Step 4: Implement cdr-parser.js and cmr-parser.js**

Create `src/parser/cdr-parser.js` — reads the CSV file using `csv-parse`, skips the first row (type definitions), maps all 115 columns to their lowercase DB column names, applies type converters (epoch->date, int->IP, empty->null), generates a UUID pkid. Returns an array of plain objects ready for Postgres insert.

Create `src/parser/cmr-parser.js` — same pattern, but also parses the `varVQMetrics` semicolon-delimited field into individual columns (`moslqk`, `moslqkavg`, etc.) using `parseVarVQMetrics`.

Reference the C# `CDRRecordClassMap.cs` and `CMRRecordClassMap.cs` for exact CSV column-to-property mappings. The column order in the CSV matches the order in the C# class maps.

- [ ] **Step 5: Run tests**

```bash
npm test -- test/parser/
```

Expected: All parser tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/parser/ test/parser/ test/fixtures/
git commit -m "feat: CDR and CMR CSV parsers with type conversion"
```

---

### Task 6: Database Writers (CDR + CMR insert)

**Files:**

- Create: `src/database/cdr-writer.js`
- Create: `src/database/cmr-writer.js`
- Test: `test/database/writers.test.js`

- [ ] **Step 1: Write tests**

Create `test/database/writers.test.js` — tests that:

- Insert a CDR record and verify it exists via `SELECT`
- Insert a CMR record and verify it exists
- Dedup: inserting the same pkid twice does not create a duplicate
- Verify enrichment columns are null on initial insert

- [ ] **Step 2: Implement cdr-writer.js**

Create `src/database/cdr-writer.js` — builds the parameterized `INSERT INTO cdr (...) SELECT ... WHERE NOT EXISTS` query matching the exact 115 columns from `sql/InsertCDR.sql` plus the new enrichment columns. Uses a transaction for batch inserts. Returns count of records inserted.

- [ ] **Step 3: Implement cmr-writer.js**

Create `src/database/cmr-writer.js` — same pattern with the 25 CMR columns from `sql/InsertCMR.sql`.

- [ ] **Step 4: Run tests**

```bash
npm test -- test/database/writers.test.js
```

Expected: All pass (requires test Postgres with schema initialized).

- [ ] **Step 5: Commit**

```bash
git add src/database/cdr-writer.js src/database/cmr-writer.js test/database/writers.test.js
git commit -m "feat: CDR and CMR database writers with dedup"
```

---

### Task 7: File Watcher + Filename Parser

**Files:**

- Create: `src/watcher/file-parser.js`
- Create: `src/watcher/file-watcher.js`
- Test: `test/watcher/file-parser.test.js`

- [ ] **Step 1: Write filename parser tests**

Create `test/watcher/file-parser.test.js`:

```js
const { describe, it } = require("node:test");
const assert = require("node:assert");
const { parseFilename } = require("../../src/watcher/file-parser");

describe("parseFilename", () => {
  it("parses a CDR filename", () => {
    const result = parseFilename("cdr_StandAloneCluster_02_202603251541_1234");
    assert.deepStrictEqual(result, {
      type: "cdr",
      cluster: "StandAloneCluster",
      node: "02",
      date: "202603251541",
      sequence: "1234",
    });
  });

  it("parses a CMR filename", () => {
    const result = parseFilename("cmr_MyCluster_01_202603251541_5678");
    assert.strictEqual(result.type, "cmr");
  });

  it("returns null for non-CDR/CMR files", () => {
    assert.strictEqual(parseFilename("readme.txt"), null);
    assert.strictEqual(parseFilename(".DS_Store"), null);
  });
});
```

- [ ] **Step 2: Implement file-parser.js**

Create `src/watcher/file-parser.js`:

```js
const FILENAME_REGEX = /^(cdr|cmr)_(\w+)_(\d+)_(\d+)_(\d+)$/;

function parseFilename(filename) {
  const basename = require("path").basename(filename);
  const match = basename.match(FILENAME_REGEX);
  if (!match) return null;
  return {
    type: match[1],
    cluster: match[2],
    node: match[3],
    date: match[4],
    sequence: match[5],
  };
}

module.exports = { parseFilename };
```

- [ ] **Step 3: Run filename parser test**

```bash
npm test -- test/watcher/file-parser.test.js
```

Expected: All pass.

- [ ] **Step 4: Implement file-watcher.js**

Create `src/watcher/file-watcher.js` — uses chokidar to watch `config.cdr.incomingDir` for new files (`add` event). On new file:

1. Wait 500ms (file write completion)
2. Parse filename via `parseFilename` — skip non-CDR/CMR files
3. Check `file_processing_log` for dedup
4. Parse CSV via `cdr-parser` or `cmr-parser` based on type
5. Insert records via writers
6. Log to `file_processing_log`
7. Delete source file
8. On error: log error to `file_processing_log`, move file to error dir if configured

Exports `startWatcher(pool)` function.

- [ ] **Step 5: Commit**

```bash
git add src/watcher/ test/watcher/
git commit -m "feat: file watcher with filename parsing and processing pipeline"
```

---

### Task 8: Query Builders

**Files:**

- Create: `src/database/queries.js`
- Test: `test/database/queries.test.js`

- [ ] **Step 1: Write tests**

Create `test/database/queries.test.js` — tests for:

- `searchCdr({ caller, callee, last, limit })` builds correct SQL with `WHERE` clauses
- `traceCdr(callId)` joins CDR + CMR and returns both
- `qualityCdr({ mosBelow, jitterAbove })` joins CDR + CMR with quality filters
- `statsCdr({ type: 'volume', interval: 'hour' })` returns bucketed counts
- `statsCdr({ type: 'top_callers' })` returns top N callers
- `healthCheck()` returns record counts and timestamps

All queries should resolve lookup table descriptions (cause codes, codecs) via JOINs and include enrichment columns.

- [ ] **Step 2: Implement queries.js**

Create `src/database/queries.js`:

- `searchCdr(pool, params)` — SELECT with optional WHERE on callingpartynumber, finalcalledpartynumber, origdevicename/destdevicename, datetimeorigination range. JOINs cdr_cause for cause descriptions, cdr_codec for codec names. Includes enrichment columns. ORDER BY datetimeorigination DESC. LIMIT.
- `traceCdr(pool, callId, callManagerId)` — SELECT all CDR rows matching globalcallid_callid (+ optional callmanagerid). Separately SELECT matching CMR rows. Compute `sdl_trace_command` from min(datetimeorigination)-30s to max(datetimedisconnect)+30s.
- `qualityCdr(pool, params)` — JOIN cdr + cmr on globalcallid fields. Filter on moslqk, jitter, latency, numberpacketslost thresholds.
- `statsCdr(pool, params)` — switch on type: `volume` uses `date_trunc`, `top_callers`/`top_called` uses GROUP BY + ORDER BY count, `by_cause` joins cdr_cause, `by_device` groups by device with enrichment, `by_location` groups by device pool.
- `healthCheck(pool, incomingDir)` — count CDR, count CMR, min/max timestamps, count recent file_processing_log entries, count files in incoming dir.

Helper: `parseTimeRange(last)` — converts "30m", "2h", "1d", "7d" to a `now() - interval` clause.

- [ ] **Step 3: Run tests**

```bash
npm test -- test/database/queries.test.js
```

- [ ] **Step 4: Commit**

```bash
git add src/database/queries.js test/database/queries.test.js
git commit -m "feat: query builders for CDR search, trace, quality, stats, health"
```

---

### Task 9: REST API

**Files:**

- Create: `src/api/rest-server.js`
- Create: `src/api/routes/cdr.js`
- Create: `src/api/routes/health.js`
- Test: `test/api/rest.test.js`

- [ ] **Step 1: Write tests**

Create `test/api/rest.test.js` — uses Node's built-in `http` to test:

- `GET /api/v1/cdr/search?caller=5033466520` returns 200 + JSON array
- `GET /api/v1/cdr/trace/12345` returns 200 + JSON with cdr, cmr, sdl_trace_command
- `GET /api/v1/cdr/quality?mos_below=3.5` returns 200
- `GET /api/v1/cdr/stats/volume?interval=hour&last=7d` returns 200
- `GET /api/v1/cdr/stats/top-callers` returns 200
- `GET /api/v1/health` returns 200 + JSON with database status

- [ ] **Step 2: Implement routes**

Create `src/api/routes/health.js`:

```js
const { healthCheck } = require("../../database/queries");

function healthRoutes(router, pool) {
  router.get("/health", async (req, res) => {
    try {
      const result = await healthCheck(
        pool,
        require("../../config").cdr.incomingDir,
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = healthRoutes;
```

Create `src/api/routes/cdr.js` — maps query params to the query builder functions:

- `/api/v1/cdr/search` → `searchCdr`
- `/api/v1/cdr/trace/:callId` → `traceCdr`
- `/api/v1/cdr/quality` → `qualityCdr`
- `/api/v1/cdr/stats/:type` → `statsCdr`

Create `src/api/rest-server.js` — Express app, mounts routes, exports `createRestServer(pool)`.

- [ ] **Step 3: Run tests**

```bash
npm test -- test/api/rest.test.js
```

- [ ] **Step 4: Commit**

```bash
git add src/api/ test/api/
git commit -m "feat: REST API with CDR search, trace, quality, stats, health"
```

---

### Task 10: MCP Server

**Files:**

- Create: `src/mcp/mcp-server.js`
- Create: `src/mcp/tools/cdr-search.js`
- Create: `src/mcp/tools/cdr-trace.js`
- Create: `src/mcp/tools/cdr-quality.js`
- Create: `src/mcp/tools/cdr-stats.js`
- Create: `src/mcp/tools/cdr-health.js`

- [ ] **Step 1: Implement MCP tool definitions**

Note: `@modelcontextprotocol/sdk` was already installed in Task 1.

Each tool file exports a tool definition object with `name`, `description`, `inputSchema` (JSON Schema), and `handler(params, pool)` function. The handlers reuse the same query builder functions from `src/database/queries.js`.

Create `src/mcp/tools/cdr-search.js`:

```js
const { searchCdr } = require("../../database/queries");

module.exports = {
  name: "cdr_search",
  description:
    "Search CDR records by caller, callee, device, time range, or cause code",
  inputSchema: {
    type: "object",
    properties: {
      caller: {
        type: "string",
        description: "Calling party number (partial match)",
      },
      callee: {
        type: "string",
        description: "Called party number (partial match)",
      },
      device: { type: "string", description: "Device name (orig or dest)" },
      last: {
        type: "string",
        description: "Relative time: 30m, 2h, 1d, 7d (default: 24h)",
      },
      start: { type: "string", description: "Absolute start time (ISO 8601)" },
      end: { type: "string", description: "Absolute end time (ISO 8601)" },
      cause: { type: "integer", description: "Disconnect cause code" },
      limit: { type: "integer", description: "Max results (default: 25)" },
    },
  },
  handler: async (params, pool) => {
    const results = await searchCdr(pool, params);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  },
};
```

Create the remaining 4 tools following the same pattern, mapping to `traceCdr`, `qualityCdr`, `statsCdr`, `healthCheck`.

- [ ] **Step 3: Implement mcp-server.js**

Create `src/mcp/mcp-server.js` — sets up an MCP server using `@modelcontextprotocol/sdk` with streamable HTTP transport. Registers all 5 tools. Mounts on the Express app at `/mcp` path so both REST and MCP share the same port.

```js
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");

// Register tools, create transport, attach to Express app
```

- [ ] **Step 4: Commit**

```bash
git add src/mcp/
git commit -m "feat: MCP server with CDR search, trace, quality, stats, health tools"
```

---

### Task 11: AXL Enrichment

**Files:**

- Create: `src/enrichment/cache.js`
- Create: `src/enrichment/device-lookup.js`
- Create: `src/enrichment/dn-lookup.js`
- Create: `src/enrichment/route-lookup.js`
- Create: `src/enrichment/enricher.js`
- Test: `test/enrichment/cache.test.js`

- [ ] **Step 1: Write cache tests**

Create `test/enrichment/cache.test.js` — tests that:

- `getCache(pool, key)` returns null for missing keys
- `setCache(pool, key, type, data, ttlSeconds)` stores and retrieves
- Expired cache entries are not returned
- `clearExpired(pool)` removes expired entries

- [ ] **Step 2: Implement cache.js**

Create `src/enrichment/cache.js`:

```js
async function getCache(pool, key) {
  const result = await pool.query(
    `SELECT data FROM enrichment_cache WHERE cache_key = $1 AND expires_at > now()`,
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
  await pool.query(`DELETE FROM enrichment_cache WHERE expires_at < now()`);
}

module.exports = { getCache, setCache, clearExpired };
```

- [ ] **Step 3: Implement lookup modules**

Create `src/enrichment/device-lookup.js` — given a device name (e.g., `SEPFE5033466520`), uses the `cisco-axl` npm library to call `getPhone`, `getGateway`, or `getSipTrunk`. Returns `{ description, user, devicePool, location }`. Falls back gracefully if AXL is not configured.

Create `src/enrichment/dn-lookup.js` — given a DN, calls `getLine` to get partition/CSS, then `listUser` to find associated user.

Create `src/enrichment/route-lookup.js` — given a called number, calls `listRoutePattern` to find matching pattern.

All lookups check cache first, store results in cache, and are non-blocking on failure (return null fields).

- [ ] **Step 4: Implement enricher.js**

Create `src/enrichment/enricher.js` — orchestrator that takes an array of CDR records and enriches them in batch:

```js
async function enrichCdrRecords(pool, records, axlConfig) {
  if (!axlConfig.host) return records; // AXL not configured, skip

  // Collect unique device names and DNs across all records
  // Batch lookup (with cache)
  // Apply enrichment fields to each record
  // Set enriched_at timestamp
  return records;
}
```

- [ ] **Step 5: Run cache tests**

```bash
npm test -- test/enrichment/cache.test.js
```

- [ ] **Step 6: Commit**

```bash
git add src/enrichment/ test/enrichment/
git commit -m "feat: AXL enrichment with caching for devices, DNs, route patterns"
```

---

### Task 12: Entry Point + Data Retention

**Files:**

- Create: `src/index.js`
- Create: `src/retention.js`

- [ ] **Step 1: Implement retention.js**

Create `src/retention.js`:

```js
const cron = require("node-cron");

function startRetentionJob(pool, retentionDays) {
  // Run daily at 2:00 AM
  cron.schedule("0 2 * * *", async () => {
    console.log(
      `Retention: purging records older than ${retentionDays} days...`,
    );
    try {
      const cdrResult = await pool.query(
        `DELETE FROM cdr WHERE datetimeorigination < now() - $1 * interval '1 day'`,
        [retentionDays],
      );
      console.log(`Retention: deleted ${cdrResult.rowCount} CDR records`);

      const cmrResult = await pool.query(
        `DELETE FROM cmr WHERE datetimestamp < now() - $1 * interval '1 day'`,
        [retentionDays],
      );
      console.log(`Retention: deleted ${cmrResult.rowCount} CMR records`);

      await pool.query("VACUUM cdr");
      await pool.query("VACUUM cmr");

      const { clearExpired } = require("./enrichment/cache");
      await clearExpired(pool);
      console.log("Retention: complete");
    } catch (err) {
      console.error("Retention error:", err.message);
    }
  });
}

module.exports = { startRetentionJob };
```

- [ ] **Step 2: Implement index.js**

Create `src/index.js`:

```js
const config = require("./config");
const pool = require("./database/pool");
const { initSchema } = require("./database/schema");
const { startWatcher } = require("./watcher/file-watcher");
const { createRestServer } = require("./api/rest-server");
const { createMcpServer } = require("./mcp/mcp-server");
const { startRetentionJob } = require("./retention");

async function waitForDatabase(pool, maxRetries = 10, delayMs = 3000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      console.log(`Waiting for database... (${i + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("Database connection failed after retries");
}

async function main() {
  console.log("cisco-cucm-cdr starting...");

  // 1. Wait for database with retry
  await waitForDatabase(pool);

  // 2. Initialize database schema
  await initSchema(pool);

  // 2. Create Express app with REST routes
  const app = createRestServer(pool);

  // 3. Mount MCP server on Express app
  await createMcpServer(app, pool);

  // 4. Start HTTP server
  app.listen(config.server.port, () => {
    console.log(`MCP + REST API listening on port ${config.server.port}`);
  });

  // 5. Start file watcher
  startWatcher(pool);

  // 6. Start retention cron job
  startRetentionJob(pool, config.cdr.retentionDays);

  console.log("cisco-cucm-cdr ready.");
}

main().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Wire enrichment into file watcher**

Modify `src/watcher/file-watcher.js` to import and call the enricher between CSV parsing and database insert:

```js
const { enrichCdrRecords } = require("../enrichment/enricher");
const config = require("../config");

// In the processing pipeline, after parsing and before insert:
// if (fileInfo.type === 'cdr') {
//   records = await enrichCdrRecords(pool, records, config.axl);
// }
```

This wires AXL enrichment into the pipeline. If AXL is not configured (`AXL_HOST` is empty), enrichment is silently skipped and raw records are inserted.

- [ ] **Step 4: Commit**

```bash
git add src/index.js src/retention.js src/watcher/file-watcher.js
git commit -m "feat: entry point with startup sequence, retention, and enrichment wiring"
```

---

### Task 13: Docker + Compose

**Files:**

- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `docker-compose.external-db.yml`
- Create: `.dockerignore`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY sql/ ./sql/
COPY src/ ./src/

RUN mkdir -p /data/incoming && chown node:node /data/incoming

USER node

EXPOSE 3000

CMD ["node", "src/index.js"]
```

- [ ] **Step 2: Create .dockerignore**

```
node_modules
test
docs
.git
.env
*.md
```

- [ ] **Step 3: Create docker-compose.yml**

Copy the compose from the spec (with bundled Postgres).

- [ ] **Step 4: Create docker-compose.external-db.yml**

Copy the compose from the spec (processor only).

- [ ] **Step 5: Test docker build**

```bash
docker compose build
```

Expected: Build succeeds.

- [ ] **Step 6: Test docker compose up**

```bash
docker compose up -d
docker compose logs cdr-processor
```

Expected: Logs show schema initialization and "cisco-cucm-cdr ready."

- [ ] **Step 7: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.yml docker-compose.external-db.yml
git commit -m "feat: Docker and Compose files for lab and production deployment"
```

---

### Task 14: Integration Test with Sample CDR Files

**Files:**

- Test: `test/integration/pipeline.test.js`

- [ ] **Step 1: Write integration test**

Create `test/integration/pipeline.test.js` — end-to-end test that:

1. Starts with a clean test database
2. Initializes schema
3. Copies a sample CDR file to the watched directory
4. Waits for processing
5. Queries database to verify CDR was inserted
6. Calls REST API `/api/v1/cdr/search` and verifies response
7. Calls REST API `/api/v1/health` and verifies file_processing_log

- [ ] **Step 2: Run integration test**

```bash
npm test -- test/integration/pipeline.test.js
```

- [ ] **Step 3: Commit**

```bash
git add test/integration/
git commit -m "test: integration test for full CDR processing pipeline"
```

---

### Task 15: README

**Files:**

- Create: `README.md`

- [ ] **Step 1: Write README**

Cover: what it does, quick start (docker compose up), configuration (.env), CUCM billing server setup, MCP configuration for Claude Code, REST API reference, architecture diagram, migration from C# app.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup, configuration, and API reference"
```
