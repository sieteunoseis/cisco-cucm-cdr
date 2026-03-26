const { Pool } = require("pg");
const config = require("../config");

const pool = new Pool({ connectionString: config.database.url });

pool.on("error", (err) => {
  console.error("Unexpected Postgres pool error:", err.message);
});

module.exports = pool;
