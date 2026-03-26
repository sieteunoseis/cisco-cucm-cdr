"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { parseCmrFile } = require("../../src/parser/cmr-parser");

const FIXTURE = path.join(__dirname, "../fixtures/sample_cmr.txt");

test("parseCmrFile returns 1 record", async () => {
  const records = await parseCmrFile(FIXTURE);
  assert.equal(records.length, 1);
});

test("moslqk is 3.5", async () => {
  const [rec] = await parseCmrFile(FIXTURE);
  assert.equal(rec.moslqk, 3.5);
});

test("moslqkavg is 3.4", async () => {
  const [rec] = await parseCmrFile(FIXTURE);
  assert.equal(rec.moslqkavg, 3.4);
});

test("pkid is the GUID from the CSV", async () => {
  const [rec] = await parseCmrFile(FIXTURE);
  assert.equal(rec.pkid, "b2c3d4e5-f6a7-8901-bcde-f12345678901");
});

test("devicename is 'SEPFE5033466520'", async () => {
  const [rec] = await parseCmrFile(FIXTURE);
  assert.equal(rec.devicename, "SEPFE5033466520");
});
