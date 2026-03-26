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
    assert.strictEqual(result.cluster, "MyCluster");
  });

  it("parses filename from full path", () => {
    const result = parseFilename(
      "/data/incoming/cdr_Cluster_01_202603251541_100",
    );
    assert.strictEqual(result.type, "cdr");
  });

  it("returns null for non-CDR/CMR files", () => {
    assert.strictEqual(parseFilename("readme.txt"), null);
    assert.strictEqual(parseFilename(".DS_Store"), null);
    assert.strictEqual(parseFilename(""), null);
  });
});
