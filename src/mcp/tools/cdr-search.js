const { z } = require("zod");
const { searchCdr } = require("../../database/queries");

module.exports = {
  name: "cdr_search",
  description:
    "Search CDR records by calling/called number, device name, cause code, or time range. Returns call detail records with lookup descriptions and enrichment data.",
  inputSchema: z.object({
    calling: z
      .string()
      .optional()
      .describe("Calling party number (partial match supported)"),
    called: z
      .string()
      .optional()
      .describe("Final called party number (partial match supported)"),
    device: z
      .string()
      .optional()
      .describe("Originating or destination device name (partial match)"),
    cause: z
      .string()
      .optional()
      .describe(
        'Cause code value to filter on (e.g. "16" for normal clearance)',
      ),
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
    const rows = await searchCdr(pool, params);
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
