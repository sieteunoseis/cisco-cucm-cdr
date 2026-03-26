const express = require("express");
const { createCdrRouter } = require("./routes/cdr");
const { createHealthRouter } = require("./routes/health");

function createRestServer(pool) {
  const app = express();

  app.use(express.json());

  // Mount routes
  app.use("/api/v1/cdr", createCdrRouter(pool));
  app.use("/api/v1/health", createHealthRouter(pool));

  // 404 fallback for unknown API routes
  app.use("/api", (req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}

module.exports = { createRestServer };
