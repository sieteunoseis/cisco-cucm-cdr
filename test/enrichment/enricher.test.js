const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const {
  findClusterConfig,
  collectDeviceNames,
  mapEnrichmentToRecords,
} = require("../../src/enrichment/enricher");

describe("enricher - findClusterConfig", () => {
  const clusters = [
    { host: "cucm1", clusterId: "ohsuCUCMprod" },
    { host: "cucm2", clusterId: "cucmOHSUtest" },
  ];

  it("matches cluster by globalcallid_clusterid", () => {
    const result = findClusterConfig(clusters, "ohsuCUCMprod");
    assert.strictEqual(result.host, "cucm1");
  });

  it("returns null when no match", () => {
    const result = findClusterConfig(clusters, "unknownCluster");
    assert.strictEqual(result, null);
  });

  it("returns null for empty clusters array", () => {
    const result = findClusterConfig([], "ohsuCUCMprod");
    assert.strictEqual(result, null);
  });
});

describe("enricher - collectDeviceNames", () => {
  it("collects unique orig and dest device names", () => {
    const records = [
      { origdevicename: "SEP111", destdevicename: "SEP222" },
      { origdevicename: "SEP111", destdevicename: "SEP333" },
      { origdevicename: "SEP444", destdevicename: "SEP222" },
    ];
    const names = collectDeviceNames(records);
    assert.deepStrictEqual([...names].sort(), [
      "SEP111",
      "SEP222",
      "SEP333",
      "SEP444",
    ]);
  });

  it("ignores empty and null device names", () => {
    const records = [
      { origdevicename: "SEP111", destdevicename: "" },
      { origdevicename: null, destdevicename: "SEP222" },
      { origdevicename: undefined, destdevicename: "SEP333" },
    ];
    const names = collectDeviceNames(records);
    assert.deepStrictEqual([...names].sort(), ["SEP111", "SEP222", "SEP333"]);
  });
});

describe("enricher - mapEnrichmentToRecords", () => {
  it("maps cached device data onto CDR records", () => {
    const records = [{ origdevicename: "SEP111", destdevicename: "SEP222" }];
    const deviceMap = new Map([
      [
        "SEP111",
        {
          description: "John Phone",
          userid: "jwordenj",
          devicepool: "DP_Portland",
          location: "LOC_Portland",
        },
      ],
      [
        "SEP222",
        {
          description: "Front Desk",
          userid: "frontdesk",
          devicepool: "DP_Portland",
          location: "LOC_Portland",
        },
      ],
    ]);

    const result = mapEnrichmentToRecords(records, deviceMap);
    assert.strictEqual(result[0].orig_device_description, "John Phone");
    assert.strictEqual(result[0].orig_device_user, "jwordenj");
    assert.strictEqual(result[0].orig_device_pool, "DP_Portland");
    assert.strictEqual(result[0].orig_device_location, "LOC_Portland");
    assert.strictEqual(result[0].dest_device_description, "Front Desk");
    assert.strictEqual(result[0].dest_device_user, "frontdesk");
    assert.strictEqual(result[0].dest_device_pool, "DP_Portland");
    assert.strictEqual(result[0].dest_device_location, "LOC_Portland");
    assert.ok(result[0].enriched_at instanceof Date);
  });

  it("leaves fields null when device not in map", () => {
    const records = [{ origdevicename: "SEP111", destdevicename: "UNKNOWN" }];
    const deviceMap = new Map([
      [
        "SEP111",
        {
          description: "John Phone",
          userid: "jwordenj",
          devicepool: "DP_Portland",
          location: "LOC_Portland",
        },
      ],
    ]);

    const result = mapEnrichmentToRecords(records, deviceMap);
    assert.strictEqual(result[0].orig_device_description, "John Phone");
    assert.strictEqual(result[0].dest_device_description, undefined);
    assert.strictEqual(result[0].dest_device_user, undefined);
  });
});
