const { z } = require("zod");
const { qualityCdr } = require("../../database/queries");

module.exports = {
  name: "cdr_quality",
  description:
    "Find poor-quality calls by joining CDR and CMR data. Filter by MOS score, jitter, latency, or packet loss thresholds.",
  inputSchema: z.object({
    mos_below: z
      .number()
      .optional()
      .describe(
        "Return calls where MOS LQK is below this value (default: 3.5)",
      ),
    jitter_above: z
      .number()
      .optional()
      .describe("Return calls where jitter (ms) is above this value"),
    latency_above: z
      .number()
      .optional()
      .describe("Return calls where latency (ms) is above this value"),
    loss_above: z
      .number()
      .optional()
      .describe("Return calls where packet loss count is above this value"),
    last: z
      .string()
      .optional()
      .describe("Relative time range: 30m, 2h, 1d, 7d (default: 24h)"),
    start: z.string().optional().describe("Start timestamp (ISO 8601)"),
    end: z.string().optional().describe("End timestamp (ISO 8601)"),
    limit: z
      .number()
      .optional()
      .describe("Maximum records to return (default 100, max 1000)"),
  }),
  async handler(params, pool) {
    const rows = await qualityCdr(pool, params);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ count: rows.length, results: rows }, null, 2),
        },
      ],
    };
  },
};
