const { z } = require("zod");
const config = require("../../config");
const { healthCheck } = require("../../database/queries");

module.exports = {
  name: "cdr_health",
  description:
    "Check the health of the CDR processor: database record counts, recent file processing activity, enrichment cache stats, and pending files in the incoming directory.",
  inputSchema: z.object({}),
  async handler(params, pool) {
    const result = await healthCheck(pool, config.cdr.incomingDir);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
};
