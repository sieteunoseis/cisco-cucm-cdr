const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

describe("config - multi-cluster AXL parsing", () => {
  const savedEnv = {};
  const AXL_KEYS = [
    "AXL_HOST_1",
    "AXL_USERNAME_1",
    "AXL_PASSWORD_1",
    "AXL_VERSION_1",
    "AXL_CLUSTER_ID_1",
    "AXL_HOST_2",
    "AXL_USERNAME_2",
    "AXL_PASSWORD_2",
    "AXL_VERSION_2",
    "AXL_CLUSTER_ID_2",
    "AXL_HOST",
    "AXL_USERNAME",
    "AXL_PASSWORD",
    "AXL_VERSION",
    "AXL_CACHE_TTL",
  ];

  beforeEach(() => {
    AXL_KEYS.forEach((k) => {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    });
  });

  afterEach(() => {
    AXL_KEYS.forEach((k) => {
      if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
      else delete process.env[k];
    });
    delete require.cache[require.resolve("../src/config")];
  });

  it("parses numbered cluster configs", () => {
    process.env.AXL_HOST_1 = "cucm1.example.com";
    process.env.AXL_USERNAME_1 = "admin1";
    process.env.AXL_PASSWORD_1 = "pass1";
    process.env.AXL_VERSION_1 = "14.0";
    process.env.AXL_CLUSTER_ID_1 = "ohsuCUCMprod";

    process.env.AXL_HOST_2 = "cucm2.example.com";
    process.env.AXL_USERNAME_2 = "admin2";
    process.env.AXL_PASSWORD_2 = "pass2";
    process.env.AXL_CLUSTER_ID_2 = "cucmOHSUtest";

    delete require.cache[require.resolve("../src/config")];
    const config = require("../src/config");

    assert.strictEqual(config.axl.clusters.length, 2);
    assert.strictEqual(config.axl.clusters[0].host, "cucm1.example.com");
    assert.strictEqual(config.axl.clusters[0].clusterId, "ohsuCUCMprod");
    assert.strictEqual(config.axl.clusters[0].version, "14.0");
    assert.strictEqual(config.axl.clusters[1].host, "cucm2.example.com");
    assert.strictEqual(config.axl.clusters[1].clusterId, "cucmOHSUtest");
    assert.strictEqual(config.axl.clusters[1].version, "15.0");
  });

  it("returns empty clusters array when no AXL env vars set", () => {
    delete require.cache[require.resolve("../src/config")];
    const config = require("../src/config");

    assert.strictEqual(config.axl.clusters.length, 0);
  });

  it("skips slots with missing host", () => {
    process.env.AXL_USERNAME_1 = "admin1";
    process.env.AXL_PASSWORD_1 = "pass1";
    process.env.AXL_CLUSTER_ID_1 = "cluster1";

    process.env.AXL_HOST_2 = "cucm2.example.com";
    process.env.AXL_USERNAME_2 = "admin2";
    process.env.AXL_PASSWORD_2 = "pass2";
    process.env.AXL_CLUSTER_ID_2 = "cluster2";

    delete require.cache[require.resolve("../src/config")];
    const config = require("../src/config");

    assert.strictEqual(config.axl.clusters.length, 1);
    assert.strictEqual(config.axl.clusters[0].clusterId, "cluster2");
  });

  it("skips slots with missing credentials", () => {
    process.env.AXL_HOST_1 = "cucm1.example.com";
    // No username or password for slot 1

    process.env.AXL_HOST_2 = "cucm2.example.com";
    process.env.AXL_USERNAME_2 = "admin2";
    process.env.AXL_PASSWORD_2 = "pass2";
    process.env.AXL_CLUSTER_ID_2 = "cluster2";

    delete require.cache[require.resolve("../src/config")];
    const config = require("../src/config");

    assert.strictEqual(config.axl.clusters.length, 1);
    assert.strictEqual(config.axl.clusters[0].host, "cucm2.example.com");
  });

  it("reads cache TTL from env with default", () => {
    process.env.AXL_CACHE_TTL = "7200";
    delete require.cache[require.resolve("../src/config")];
    const config = require("../src/config");
    assert.strictEqual(config.axl.cacheTtl, 7200);
  });

  it("defaults cache TTL to 86400", () => {
    delete require.cache[require.resolve("../src/config")];
    const config = require("../src/config");
    assert.strictEqual(config.axl.cacheTtl, 86400);
  });
});
