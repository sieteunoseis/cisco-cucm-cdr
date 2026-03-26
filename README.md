# cisco-cucm-cdr

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docker Hub](https://img.shields.io/docker/v/sieteunoseis/cisco-cucm-cdr?label=Docker%20Hub)](https://hub.docker.com/r/sieteunoseis/cisco-cucm-cdr)
[![Docker Pulls](https://img.shields.io/docker/pulls/sieteunoseis/cisco-cucm-cdr)](https://hub.docker.com/r/sieteunoseis/cisco-cucm-cdr)

A Dockerized Node.js application that collects, parses, enriches, and stores Cisco Unified Communications Manager (CUCM) Call Detail Records (CDR) and Call Management Records (CMR). Compatible with CUCM 12.x through 15.x.

## What It Does

1. Watches a host-mounted volume for CUCM CDR/CMR files pushed via SFTP
2. Parses CDR (133 columns) and CMR (48 columns) CSV files — supports CUCM 12.x through 15.x
3. Enriches data via cisco-axl (device names, users, device pools, locations) — optional, skipped if not configured
4. Stores records in PostgreSQL using a schema compatible with the existing C# callmanagercdrcollector app
5. Creates `cdr_basic`, `cdr_augmented`, and `cmr_augmented` views for existing team SQL queries
6. Exposes an MCP server (streamable HTTP) for AI agent access (Claude Code, cisco-uc-engineer skill)
7. Exposes a REST API for dashboards and integrations
8. Auto-detects fresh vs. existing database and runs idempotent migrations on every startup
9. Daily retention purge (configurable, default 90 days)

## Architecture

```
CUCM ──SFTP (port 22)──> Host OS ──> /var/cdr-incoming/
                                            │ (volume mount)
                              ┌─────────────┘
                              ▼
                    ┌─────────────────────┐
                    │   CDR Processor     │
                    │   (container)       │
                    │                     │
                    │  File Watcher       │──cisco-axl──> CUCM
                    │  CSV Parser         │
                    │  AXL Enrichment     │
                    │  Postgres Writer    │
                    │  MCP Server (HTTP)  │◄── Claude Code / AI agents
                    │  REST API           │◄── Grafana / dashboards
                    └────────┬────────────┘
                             │
                    ┌────────┴────────────┐
                    │     PostgreSQL      │
                    │    (container)      │
                    └─────────────────────┘
```

## Quick Start

### Option 1: Bundled Postgres (lab/dev, fresh install)

```bash
# Create the incoming directory on the host
mkdir -p /var/cdr-incoming

# Copy and edit the environment file
cp .env.example .env

# Start both containers
docker compose up -d
```

### Option 2: External Postgres (bring your own database)

```bash
mkdir -p /var/cdr-incoming
cp .env.example .env
# Edit .env and set DATABASE_URL to your existing Postgres instance

docker compose -f docker-compose.external-db.yml up -d
```

### Verify it's running

```bash
docker compose logs -f cdr-processor
curl http://localhost:3000/health
```

## Configuration

| Variable             | Default                                                   | Description                                |
| -------------------- | --------------------------------------------------------- | ------------------------------------------ |
| `DATABASE_URL`       | `postgresql://cdr:cdr_password@postgres:5432/callmanager` | Postgres connection string                 |
| `AXL_HOST`           | (none)                                                    | CUCM publisher hostname for AXL enrichment |
| `AXL_USERNAME`       | (none)                                                    | AXL API username                           |
| `AXL_PASSWORD`       | (none)                                                    | AXL API password                           |
| `AXL_VERSION`        | `15.0`                                                    | CUCM AXL schema version                    |
| `CDR_INCOMING_DIR`   | `/data/incoming`                                          | Directory to watch for CDR/CMR files       |
| `CDR_RETENTION_DAYS` | `90`                                                      | Days to retain CDR/CMR data                |
| `MCP_PORT`           | `3000`                                                    | Port for MCP + REST API server             |
| `LOG_LEVEL`          | `info`                                                    | Log level                                  |
| `POSTGRES_PASSWORD`  | `cdr_password`                                            | Postgres password (compose only)           |
| `POSTGRES_PORT`      | `5432`                                                    | Postgres exposed port (compose only)       |

AXL enrichment is optional. If `AXL_HOST`, `AXL_USERNAME`, and `AXL_PASSWORD` are not set, the processor skips enrichment and stores raw CDR/CMR data only.

## CUCM Billing Server Setup

Configure in Cisco Unified Serviceability > Tools > CDR Management. Add a billing server with these values:

| Field                | Value                                       |
| -------------------- | ------------------------------------------- |
| Host Name/IP Address | Your billing server hostname or IP          |
| User Name            | SFTP username on the host                   |
| Password             | SFTP password                               |
| Protocol             | SFTP                                        |
| Directory Path       | `/var/cdr-incoming` (or wherever you mount) |

Note: CUCM hardcodes port 22 for SFTP — there is no port field in the UI.

## REST API

Base URL: `http://localhost:3000`

| Endpoint                                             | Description                                             |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `GET /api/v1/cdr/search?caller=5033466520&last=24h`  | Search CDR by caller, callee, device, cause, time range |
| `GET /api/v1/cdr/trace/:callId`                      | Full call trace with CDR + CMR records                  |
| `GET /api/v1/cdr/quality?mos_below=3.5&last=7d`      | Find poor-quality calls by MOS threshold                |
| `GET /api/v1/cdr/stats/volume?interval=hour&last=7d` | Call volume over time                                   |
| `GET /api/v1/cdr/stats/top-callers?last=1d&limit=10` | Top callers by call count                               |
| `GET /api/v1/cdr/stats/by-cause?last=7d`             | Call counts grouped by disconnect cause                 |
| `GET /api/v1/cdr/stats/by-device?last=7d`            | Call counts grouped by device                           |
| `GET /health`                                        | Health check — database stats, file processing activity |

## MCP Server (AI Agent Access)

The application exposes a [Model Context Protocol](https://modelcontextprotocol.io) server at `http://localhost:3000/mcp` (streamable HTTP transport).

### Available MCP Tools

| Tool          | Description                                                  |
| ------------- | ------------------------------------------------------------ |
| `cdr_search`  | Search CDR by caller, callee, device, cause, time range      |
| `cdr_trace`   | Full call trace with CDR + CMR + cisco-dime SDL command      |
| `cdr_quality` | Find poor-quality calls by MOS, jitter, latency, packet loss |
| `cdr_stats`   | Call volume, top callers/called, by cause/device/location    |
| `cdr_health`  | Database stats, file processing activity, cache status       |

### Claude Code Configuration

Add to your Claude Code MCP settings:

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

## SQL Views

Three views are created automatically on startup for use in DBeaver, psql, or Grafana:

| View            | Description                                                      |
| --------------- | ---------------------------------------------------------------- |
| `cdr_basic`     | Core call fields with human-readable timestamps                  |
| `cdr_augmented` | CDR with cause code descriptions, codec names, on-behalf-of text |
| `cmr_augmented` | CMR records with local/remote device names joined from CDR       |

## Migration from the C# App

The database schema is fully compatible with the existing C# callmanagercdrcollector application. On first startup against an existing database:

1. Detects existing `cdr` and `cmr` tables
2. Adds CUCM 14/15 columns and enrichment columns using `IF NOT EXISTS`
3. Creates performance indexes
4. Creates the three SQL views
5. Existing data is untouched

No manual migration steps are required.

## CUCM Version Compatibility

| CUCM Version | CDR Columns | CMR Columns | Status    |
| ------------ | ----------- | ----------- | --------- |
| 12.x         | 133         | 48          | Supported |
| 14.x         | 133+        | 48+         | Supported |
| 15.x         | 133+        | 48+         | Supported |

## Docker Compose Files

| File                             | Use Case                                       |
| -------------------------------- | ---------------------------------------------- |
| `docker-compose.yml`             | Lab/dev — includes bundled Postgres            |
| `docker-compose.external-db.yml` | Production — processor only, external Postgres |

## License

MIT
