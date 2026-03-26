# cisco-cucm-cdr Design Spec

**Date:** 2026-03-25
**Status:** Draft
**Author:** Jeremy Worden + Claude

## Problem

Cisco CUCM generates CDR (Call Detail Records) and CMR (Call Management Records) that are only accessible via SFTP push to a billing server. There is no pull API, no custom port option, and no built-in query interface. Existing CDR data is siloed in flat CSV files with raw integer codes that require cross-referencing CUCM configuration to interpret.

The existing C# Windows Service (`callmanagercdrcollector`) solves the parsing and storage problem but lacks:

- AXL enrichment (device names, users, partitions are raw IDs)
- Query API (data is write-only into Postgres)
- AI agent integration (no MCP or CLI interface)
- Cross-tool correlation (no link to SDL traces, SBC logs, or Genesys conversations)
- Container-based deployment

## Solution

A Dockerized Node.js application that:

1. Watches a host-mounted volume for CDR/CMR files pushed by CUCM via SFTP
2. Parses CSV files and enriches data via cisco-axl (CUCM AXL API)
3. Stores enriched records in PostgreSQL (schema-compatible with existing C# app)
4. Exposes an MCP server (streamable HTTP) for AI agent access
5. Exposes a REST API for dashboards and integrations
6. Correlates CDR data with cisco-dime SDL traces for end-to-end call analysis

## Architecture

```
CUCM ──SFTP (port 22)──> Host OS ──> /var/cdr-incoming/
                                            |
                                     (volume mount)
                                            |
                          +-----------------+------------------+
                          |                                    |
                          v                                    v
               +---------------------+              +------------------+
               |   CDR Processor     |              |   PostgreSQL     |
               |   (container)       |              |   (container)    |
               |                     |              |                  |
               |  File Watcher       |              |  Schema:         |
               |  CSV Parser         |              |   cdr (115 cols) |
               |  AXL Enrichment ----+--AXL--> CUCM |   cmr (25 cols)  |
               |  Postgres Writer ---+------------->|   cdr_cause      |
               |  MCP Server (HTTP) <+----- AI -----|   cdr_codec      |
               |  REST API          <+----- HTTP ---|   cdr_onbehalfof |
               +---------------------+              |   cdr_reason     |
                                                    |   enrichment_*   |
                                                    +------------------+
```

### Host SFTP Setup (prerequisite, not managed by this tool)

The host OS runs its native SFTP server on port 22. CUCM is configured via **Cisco Unified Serviceability > Tools > CDR Management** to push CDR/CMR files to the host. The billing server config fields are:

| Field                | Example Value                |
| -------------------- | ---------------------------- |
| Host Name/IP Address | `billing-server.example.com` |
| User Name            | `cdr-collector`              |
| Password             | `(configured separately)`    |
| Protocol             | SFTP                         |
| Directory Path       | `/var/cdr-incoming`          |

There is no port field — CUCM hardcodes port 22 for SFTP, port 21 for FTP.

## Database Schema

### Migration Compatibility

The existing C# app's schema is preserved exactly. All existing tables (`cdr`, `cmr`, `cdr_cause`, `cdr_codec`, `cdr_onbehalfof`, `cdr_reason`) remain unchanged. New enrichment columns are added to existing tables, and new tables are created for cached AXL lookups.

### Existing Tables (unchanged)

#### `cdr` — 115 columns (preserved from C# app)

Primary key: `pkid` (UUID). Key fields:

| Field                                       | Type      | Purpose                                        |
| ------------------------------------------- | --------- | ---------------------------------------------- |
| `globalcallid_callmanagerid`                | integer   | CUCM node ID                                   |
| `globalcallid_callid`                       | integer   | Call identifier (links to SDL CI=)             |
| `globalcallid_clusterid`                    | text      | Cluster name                                   |
| `datetimeorigination`                       | timestamp | Call start                                     |
| `datetimeconnect`                           | timestamp | Answer time                                    |
| `datetimedisconnect`                        | timestamp | Call end                                       |
| `duration`                                  | interval  | Call duration                                  |
| `callingpartynumber`                        | text      | Caller number                                  |
| `originalcalledpartynumber`                 | text      | Originally dialed number                       |
| `finalcalledpartynumber`                    | text      | Final destination after redirects              |
| `lastredirectdn`                            | text      | Last redirect DN                               |
| `origdevicename`                            | text      | Originating device (e.g., SEPFE5033466520)     |
| `destdevicename`                            | text      | Destination device (e.g., trunk name)          |
| `origcause_value`                           | integer   | Originator disconnect cause (FK to cdr_cause)  |
| `destcause_value`                           | integer   | Destination disconnect cause (FK to cdr_cause) |
| `origipaddr` / `origipv4v6addr`             | inet      | Originator IP                                  |
| `destipaddr` / `destipv4v6addr`             | inet      | Destination IP                                 |
| `origmediacap_payloadcapability`            | integer   | Audio codec (FK to cdr_codec)                  |
| `currentroutingreason`                      | integer   | Routing reason (FK to cdr_reason)              |
| `huntpilotdn` / `huntpilotpartition`        | text      | Hunt pilot info                                |
| `incomingprotocolid` / `outgoingprotocolid` | integer   | SIP/SCCP/MGCP protocol                         |

Full schema: 115 columns as defined in the original `CreateSchema.sql`.

#### `cmr` — 25 columns (preserved from C# app)

| Field                                              | Type    | Purpose                  |
| -------------------------------------------------- | ------- | ------------------------ |
| `globalcallid_callid`                              | integer | Links to CDR             |
| `devicename`                                       | text    | Device reporting quality |
| `directorynum`                                     | text    | DN on the device         |
| `numberpacketssent/received/lost`                  | integer | Packet stats             |
| `jitter`                                           | integer | Jitter (ms)              |
| `latency`                                          | integer | Latency (ms)             |
| `moslqk` / `moslqkavg` / `moslqkmin` / `moslqkmax` | real    | MOS-LQK scores           |
| `concealsecs` / `severelyconcealsecs`              | real    | Concealment              |

#### Lookup Tables (preserved with original data)

- `cdr_cause` — 137 rows (Q.931 + SIP cause codes)
- `cdr_codec` — 67 rows (audio/video codecs)
- `cdr_onbehalfof` — 36 rows (call control feature types)
- `cdr_reason` — 70 rows (routing/redirect reasons)

### New Columns (added to existing tables)

Added to `cdr` table for AXL enrichment:

```sql
-- Enrichment columns (nullable, populated by AXL lookups)
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
```

### New Tables

#### `enrichment_cache` — Cached AXL lookups

```sql
CREATE TABLE enrichment_cache (
    cache_key text PRIMARY KEY,
    cache_type text NOT NULL,       -- 'device', 'dn', 'routepattern'
    data jsonb NOT NULL,
    fetched_at timestamp NOT NULL,
    expires_at timestamp NOT NULL
);
CREATE INDEX idx_enrichment_cache_type ON enrichment_cache(cache_type);
CREATE INDEX idx_enrichment_cache_expires ON enrichment_cache(expires_at);
```

#### `file_processing_log` — Track processed files

```sql
CREATE TABLE file_processing_log (
    filename text PRIMARY KEY,
    file_type text NOT NULL,        -- 'cdr' or 'cmr'
    cluster text,
    node text,
    file_date text,
    sequence text,
    records_inserted integer,
    processed_at timestamp NOT NULL,
    processing_time_ms integer,
    error text
);
```

### Indexes (new, for query performance)

```sql
CREATE INDEX idx_cdr_datetimeorigination ON cdr(datetimeorigination);
CREATE INDEX idx_cdr_callingpartynumber ON cdr(callingpartynumber);
CREATE INDEX idx_cdr_finalcalledpartynumber ON cdr(finalcalledpartynumber);
CREATE INDEX idx_cdr_origdevicename ON cdr(origdevicename);
CREATE INDEX idx_cdr_destdevicename ON cdr(destdevicename);
CREATE INDEX idx_cdr_globalcallid ON cdr(globalcallid_callmanagerid, globalcallid_callid);
CREATE INDEX idx_cdr_origcause_value ON cdr(origcause_value);
CREATE INDEX idx_cdr_destcause_value ON cdr(destcause_value);
CREATE INDEX idx_cmr_globalcallid ON cmr(globalcallid_callmanagerid, globalcallid_callid);
CREATE INDEX idx_cmr_devicename ON cmr(devicename);
CREATE INDEX idx_cmr_datetimestamp ON cmr(datetimestamp);
```

## CDR/CMR File Processing

### File Format

CUCM pushes files with naming pattern: `{type}_{cluster}_{node}_{date}_{sequence}`

- Example: `cdr_StandAloneCluster_02_202603251541_1234`
- Regex: `^(cdr|cmr)_(\w+)_(\d+)_(\d+)_(\d+)$`

CSV format with a type-definition header row (skipped during parsing).

### Processing Pipeline

```
File appears in /data/incoming/
        |
        v
  [File Watcher] -- chokidar (node.js)
        |
        v
  [Parse filename] -- extract type, cluster, node, date, sequence
        |
        v
  [Check dedup] -- query file_processing_log
        |
        v
  [Parse CSV] -- csv-parse, skip header row
        |
        v
  [Type conversion]
    - Integer timestamps -> Date objects (epoch 1970-01-01)
    - Integer IPs -> IP address strings
    - Empty strings -> null
    - Duration seconds -> interval
    - CMR: parse VarVQMetrics semicolon-delimited key=value pairs
        |
        v
  [AXL Enrichment] -- batch lookup via cisco-axl library
    - origdevicename -> description, user, device pool, location
    - destdevicename -> description, user, device pool, location
    - callingpartynumber -> associated user
    - finalcalledpartynumber -> associated user, route pattern
    - Results cached in enrichment_cache (TTL: 1 hour)
        |
        v
  [Insert to Postgres] -- transaction, dedup via WHERE NOT EXISTS
        |
        v
  [Log to file_processing_log]
        |
        v
  [Delete source file]
```

### AXL Enrichment Details

Uses the `cisco-axl` npm package (same library used by the cisco-axl CLI). Lookups are batched and cached to minimize CUCM API load.

| CDR Field                | AXL Query                                 | Enrichment Fields                                                                         |
| ------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `origdevicename`         | `getPhone` / `getGateway`                 | `orig_device_description`, `orig_device_user`, `orig_device_pool`, `orig_device_location` |
| `destdevicename`         | `getPhone` / `getGateway` / `getSipTrunk` | `dest_device_description`, `dest_device_user`, `dest_device_pool`, `dest_device_location` |
| `callingpartynumber`     | `getLine` + `getUser`                     | `calling_party_user`                                                                      |
| `finalcalledpartynumber` | `listRoutePattern`                        | `route_pattern_matched`                                                                   |

**Cache strategy:**

- Device lookups cached for 1 hour (devices rarely change)
- DN/user lookups cached for 1 hour
- Route patterns cached for 1 hour
- Cache stored in `enrichment_cache` table (survives container restarts)
- Enrichment failures are non-blocking — raw CDR data is always stored

**AXL configuration:** Reads from `~/.cisco-axl/config.json` (mounted as volume) or environment variables `AXL_HOST`, `AXL_USERNAME`, `AXL_PASSWORD`, `AXL_VERSION`.

## MCP Server

Streamable HTTP transport on configurable port (default 3000). Exposes tools that AI agents (Claude Code, cisco-uc-engineer skill) can call directly.

### MCP Tools

#### `cdr_search` — Search CDR records

| Parameter | Type    | Required | Description                                   |
| --------- | ------- | -------- | --------------------------------------------- |
| `caller`  | string  | no       | Calling party number (partial match)          |
| `callee`  | string  | no       | Called party number (partial match)           |
| `device`  | string  | no       | Device name (orig or dest)                    |
| `last`    | string  | no       | Relative time: 30m, 2h, 1d, 7d (default: 24h) |
| `start`   | string  | no       | Absolute start time (ISO 8601)                |
| `end`     | string  | no       | Absolute end time (ISO 8601)                  |
| `cause`   | integer | no       | Filter by disconnect cause code               |
| `limit`   | integer | no       | Max results (default: 25)                     |

Returns enriched CDR records with resolved cause codes, codec names, device descriptions, and user names.

#### `cdr_trace` — Full call trace by globalCallID

| Parameter        | Type    | Required | Description                                |
| ---------------- | ------- | -------- | ------------------------------------------ |
| `call_id`        | integer | yes      | globalcallid_callid value                  |
| `callmanager_id` | integer | no       | globalcallid_callmanagerid (disambiguates) |

Returns the complete call chain: all CDR legs + associated CMR records + enriched fields. Also returns a suggested `cisco-dime` command with a precise time window derived from the CDR timestamps:

```json
{
  "cdr": [ ... ],
  "cmr": [ ... ],
  "sdl_trace_command": "cisco-dime select \"Cisco CallManager\" --start \"2026-03-25T15:41:14\" --end \"2026-03-25T15:42:42\" --download --decompress"
}
```

The time window is calculated as: `datetimeorigination - 30s` to `datetimedisconnect + 30s`. This avoids pulling massive SDL trace files in production — only the exact window for the call.

#### `cdr_quality` — Voice quality analysis

| Parameter           | Type    | Required | Description                                    |
| ------------------- | ------- | -------- | ---------------------------------------------- |
| `mos_below`         | number  | no       | Filter calls with MOS-LQK below threshold      |
| `jitter_above`      | integer | no       | Filter calls with jitter above threshold (ms)  |
| `latency_above`     | integer | no       | Filter calls with latency above threshold (ms) |
| `packet_loss_above` | integer | no       | Filter by packet loss count                    |
| `last`              | string  | no       | Time range (default: 24h)                      |
| `limit`             | integer | no       | Max results (default: 25)                      |

Joins CDR + CMR, returns calls with quality issues along with enriched device/user info.

#### `cdr_stats` — Aggregated call statistics

| Parameter  | Type    | Required | Description                                                                           |
| ---------- | ------- | -------- | ------------------------------------------------------------------------------------- |
| `type`     | string  | yes      | One of: `volume`, `top_callers`, `top_called`, `by_cause`, `by_device`, `by_location` |
| `interval` | string  | no       | For `volume`: `hour`, `day`, `week` (default: hour)                                   |
| `last`     | string  | no       | Time range (default: 24h)                                                             |
| `limit`    | integer | no       | Max results for top-N queries (default: 10)                                           |

Returns aggregated data suitable for reporting:

- `volume` — call counts bucketed by time interval
- `top_callers` / `top_called` — top N numbers with call counts
- `by_cause` — breakdown by disconnect cause (with descriptions)
- `by_device` — call counts per device (with enriched descriptions)
- `by_location` — call counts per device pool/location

#### `cdr_health` — System health check

No parameters. Returns:

- Database connection status
- Record counts (CDR, CMR)
- Oldest/newest record timestamps
- Files processed in last hour
- AXL enrichment cache stats
- Pending files in incoming directory

### REST API

Same endpoints as MCP tools, exposed as REST for non-MCP consumers:

```
GET /api/v1/cdr/search?caller=5033466520&last=24h
GET /api/v1/cdr/trace/:callId
GET /api/v1/cdr/quality?mos_below=3.5&last=7d
GET /api/v1/cdr/stats/volume?interval=hour&last=7d
GET /api/v1/cdr/stats/top-callers?last=1d&limit=10
GET /api/v1/cdr/health
```

## Cross-Tool Correlation

### CDR → SDL Trace (cisco-dime)

The `cdr_trace` tool provides a precise `cisco-dime` command using CDR timestamps. The link between systems:

| CDR Field             | SDL Trace Field                |
| --------------------- | ------------------------------ |
| `globalcallid_callid` | `CI=` in SDL signals           |
| `origdevicename`      | Device name in SDL             |
| `destdevicename`      | Trunk/device name in SDL       |
| `datetimeorigination` | Timestamp range for trace pull |

### CDR → Genesys (genesys-cli)

For calls routed to Genesys via AudioCodes SBC:

| CDR Field                | Genesys Correlation           |
| ------------------------ | ----------------------------- |
| `callingpartynumber`     | `conversations list --caller` |
| `finalcalledpartynumber` | `conversations list --callee` |
| `datetimeorigination`    | Conversation timestamp        |
| `destdevicename`         | SIP trunk name → BYOC trunk   |

### CDR → AudioCodes SBC (audiocodes-cli)

| CDR Field                       | AudioCodes Correlation            |
| ------------------------------- | --------------------------------- |
| `destipaddr` / `destipv4v6addr` | SBC IP address                    |
| `datetimeorigination`           | Call timestamp for SBC call stats |

## Docker Compose

Two compose files: one with bundled Postgres, one without. Use the profile that matches your environment.

### With Bundled Postgres (lab/dev, or fresh install)

`docker-compose.yml` — includes a Postgres container for environments with no existing database:

```yaml
version: "3.8"

services:
  cdr-processor:
    build: .
    container_name: cisco-cucm-cdr
    restart: unless-stopped
    ports:
      - "3000:3000" # MCP server + REST API
    volumes:
      - ${CDR_INCOMING_DIR:-/var/cdr-incoming}:/data/incoming
      - axl-config:/home/node/.cisco-axl
    environment:
      - DATABASE_URL=postgresql://cdr:${POSTGRES_PASSWORD:-cdr_password}@postgres:5432/callmanager
      - AXL_HOST=${AXL_HOST}
      - AXL_USERNAME=${AXL_USERNAME}
      - AXL_PASSWORD=${AXL_PASSWORD}
      - AXL_VERSION=${AXL_VERSION:-15.0}
      - CDR_RETENTION_DAYS=${CDR_RETENTION_DAYS:-90}
      - MCP_PORT=3000
      - LOG_LEVEL=info
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:16-alpine
    container_name: cisco-cucm-cdr-db
    restart: unless-stopped
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=callmanager
      - POSTGRES_USER=cdr
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-cdr_password}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cdr -d callmanager"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
  axl-config:
```

### Without Postgres (existing database)

`docker-compose.external-db.yml` — processor only, connects to an existing Postgres instance:

```yaml
version: "3.8"

services:
  cdr-processor:
    build: .
    container_name: cisco-cucm-cdr
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ${CDR_INCOMING_DIR:-/var/cdr-incoming}:/data/incoming
      - axl-config:/home/node/.cisco-axl
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - AXL_HOST=${AXL_HOST}
      - AXL_USERNAME=${AXL_USERNAME}
      - AXL_PASSWORD=${AXL_PASSWORD}
      - AXL_VERSION=${AXL_VERSION:-15.0}
      - CDR_RETENTION_DAYS=${CDR_RETENTION_DAYS:-90}
      - MCP_PORT=3000
      - LOG_LEVEL=info

volumes:
  axl-config:
```

Usage:

```bash
# Lab — bundled Postgres (default)
docker compose up -d

# Existing Postgres
DATABASE_URL=postgresql://cdr:secret@db.example.com:5432/callmanager \
  docker compose -f docker-compose.external-db.yml up -d
```

### Auto-Schema Setup

On startup, the CDR processor automatically handles database initialization:

```
Startup sequence:
  1. Connect to Postgres (retry with backoff, max 30s)
  2. Check: does the 'cdr' table exist?
     ├── NO  → Run CreateSchema.sql + PopulateSchema.sql (fresh install)
     └── YES → Run migrations (idempotent, IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
  3. Verify schema version
  4. Start file watcher + MCP server + REST API
```

All schema operations are idempotent — safe to run on every startup:

- `CREATE TABLE IF NOT EXISTS` for new tables
- `ALTER TABLE ADD COLUMN IF NOT EXISTS` for enrichment columns
- `CREATE INDEX IF NOT EXISTS` for performance indexes
- Lookup table inserts use `ON CONFLICT DO NOTHING`

This means:

- **Fresh install** — tables and data created automatically
- **Existing C# app database** — enrichment columns added, existing data untouched
- **Restarted container** — no-op, everything already exists

## Project Structure

```
cisco-cucm-cdr/
  docker-compose.yml
  docker-compose.prod.yml
  Dockerfile
  package.json
  src/
    index.js                    # Entry point — starts all services
    config.js                   # Environment + config loading
    watcher/
      file-watcher.js           # chokidar-based file watcher
      file-parser.js            # CDR/CMR filename parsing
    parser/
      cdr-parser.js             # CDR CSV parsing + type conversion
      cmr-parser.js             # CMR CSV parsing + VarVQMetrics
      type-converters.js        # Epoch->date, int->IP, etc.
    enrichment/
      enricher.js               # Orchestrates AXL lookups
      cache.js                  # enrichment_cache read/write
      device-lookup.js          # Phone/gateway/trunk lookups
      dn-lookup.js              # DN/user resolution
      route-lookup.js           # Route pattern matching
    database/
      pool.js                   # pg Pool setup
      schema.js                 # Schema creation + migration
      cdr-writer.js             # CDR insert (dedup)
      cmr-writer.js             # CMR insert (dedup)
      queries.js                # Query builders for search/stats
      sql/
        CreateSchema.sql        # Original schema (from C# app)
        PopulateSchema.sql      # Original lookup data
        Migration001.sql        # Add enrichment columns + indexes
    api/
      rest-server.js            # Express REST API
      routes/
        cdr.js                  # /api/v1/cdr/* routes
        health.js               # /api/v1/health
    mcp/
      mcp-server.js             # MCP streamable HTTP server
      tools/
        cdr-search.js           # cdr_search tool
        cdr-trace.js            # cdr_trace tool
        cdr-quality.js          # cdr_quality tool
        cdr-stats.js            # cdr_stats tool
        cdr-health.js           # cdr_health tool
  sql/
    CreateSchema.sql            # Copied from C# app (canonical)
    PopulateSchema.sql          # Copied from C# app (canonical)
    Migration001_enrichment.sql # New enrichment columns + indexes
  test/
    fixtures/                   # Sample CDR/CMR CSV files
    parser.test.js
    enrichment.test.js
    api.test.js
```

## Key Dependencies

| Package                     | Purpose                               |
| --------------------------- | ------------------------------------- |
| `csv-parse`                 | CDR/CMR CSV parsing                   |
| `chokidar`                  | File system watching                  |
| `pg`                        | PostgreSQL client                     |
| `express`                   | REST API                              |
| `@modelcontextprotocol/sdk` | MCP server                            |
| `cisco-axl`                 | AXL enrichment (existing npm package) |
| `uuid`                      | Generate pkid values                  |

## Data Retention

- Configurable via `CDR_RETENTION_DAYS` (default: 90)
- Daily cron job (node-cron) runs purge:
  - `DELETE FROM cdr WHERE datetimeorigination < now() - interval '$days days'`
  - `DELETE FROM cmr WHERE datetimestamp < now() - interval '$days days'`
  - `VACUUM cdr; VACUUM cmr;`
  - `DELETE FROM enrichment_cache WHERE expires_at < now()`
- Matches existing C# app behavior

## Migration Path

For environments running the existing C# app with data already in Postgres:

1. Stop the C# Windows Service
2. Run `Migration001_enrichment.sql` to add new columns and indexes
3. Start the Docker container pointing at the same database
4. Existing CDR/CMR data is preserved; new records get enrichment
5. Optionally backfill enrichment on existing records via a one-time job

## Claude Code MCP Configuration

Users add to their Claude Code settings:

```json
{
  "mcpServers": {
    "cisco-cdr": {
      "type": "url",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

The cisco-uc-engineer skill would then have access to `mcp__cisco-cdr__*` tools automatically.
