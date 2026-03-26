"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { parseCdrFile } = require("../../src/parser/cdr-parser");

const FIXTURE = path.join(__dirname, "../fixtures/sample_cdr.txt");

test("parseCdrFile returns 1 record from sample file", async () => {
  const records = await parseCdrFile(FIXTURE);
  assert.equal(records.length, 1);
});

test("datetimeorigination is a Date", async () => {
  const [rec] = await parseCdrFile(FIXTURE);
  assert.ok(rec.datetimeorigination instanceof Date);
  assert.equal(
    rec.datetimeorigination.toISOString(),
    "2024-03-25T17:01:44.000Z",
  );
});

test("origipaddr is a string IP", async () => {
  const [rec] = await parseCdrFile(FIXTURE);
  assert.equal(rec.origipaddr, "10.0.0.1");
});

test("pkid is the GUID from the CSV", async () => {
  const [rec] = await parseCdrFile(FIXTURE);
  assert.equal(rec.pkid, "a1b2c3d4-e5f6-7890-abcd-ef1234567890");
});

test("duration is an interval string", async () => {
  const [rec] = await parseCdrFile(FIXTURE);
  assert.equal(rec.duration, "60 seconds");
});

test("callingpartynumber is '5033466520'", async () => {
  const [rec] = await parseCdrFile(FIXTURE);
  assert.equal(rec.callingpartynumber, "5033466520");
});

test("origdevicename is 'SEPFE5033466520'", async () => {
  const [rec] = await parseCdrFile(FIXTURE);
  assert.equal(rec.origdevicename, "SEPFE5033466520");
});
