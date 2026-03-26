const express = require("express");
const {
  searchCdr,
  traceCdr,
  qualityCdr,
  statsCdr,
} = require("../../database/queries");

function createCdrRouter(pool) {
  const router = express.Router();

  // GET /api/v1/cdr/search
  router.get("/search", async (req, res) => {
    try {
      const rows = await searchCdr(pool, req.query);
      res.json({ count: rows.length, results: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/v1/cdr/trace/:callId
  router.get("/trace/:callId", async (req, res) => {
    try {
      const result = await traceCdr(
        pool,
        req.params.callId,
        req.query.callmanager_id,
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/v1/cdr/quality
  router.get("/quality", async (req, res) => {
    try {
      const rows = await qualityCdr(pool, req.query);
      res.json({ count: rows.length, results: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/v1/cdr/stats/:type
  router.get("/stats/:type", async (req, res) => {
    try {
      const rows = await statsCdr(pool, {
        type: req.params.type,
        ...req.query,
      });
      res.json({ type: req.params.type, count: rows.length, results: rows });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createCdrRouter };
