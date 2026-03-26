const { z } = require("zod");
const { statsCdr } = require("../../database/queries");

module.exports = {
  name: "cdr_stats",
  description:
    "Aggregate CDR statistics. Types: volume (call volume over time), top_callers, top_called, by_cause (failure analysis), by_device, by_location.",
  inputSchema: z.object({
    type: z
      .enum([
        "volume",
        "top_callers",
        "top_called",
        "by_cause",
        "by_device",
        "by_location",
      ])
      .describe("Type of statistics to generate"),
    last: z
      .string()
      .optional()
      .describe("Relative time range: 30m, 2h, 1d, 7d (default: 24h)"),
    start: z.string().optional().describe("Start timestamp (ISO 8601)"),
    end: z.string().optional().describe("End timestamp (ISO 8601)"),
    interval: z
      .enum(["minute", "hour", "day", "week", "month"])
      .optional()
      .describe("Time bucket size for volume stats (default: hour)"),
    limit: z
      .number()
      .optional()
      .describe("Maximum rows to return (default 20, max 500)"),
  }),
  async handler(params, pool) {
    const rows = await statsCdr(pool, params);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { type: params.type, count: rows.length, results: rows },
            null,
            2,
          ),
        },
      ],
    };
  },
};
