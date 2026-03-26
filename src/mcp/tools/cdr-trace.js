const { z } = require("zod");
const { traceCdr } = require("../../database/queries");

module.exports = {
  name: "cdr_trace",
  description:
    "Trace a specific call by globalcallid_callid. Returns all CDR legs, associated CMR quality records, and a ready-to-run cisco-dime SDL trace command.",
  inputSchema: z.object({
    call_id: z.string().describe("The globalcallid_callid value to trace"),
    callmanager_id: z
      .string()
      .optional()
      .describe(
        "Optional globalcallid_callmanagerid to narrow results to a specific CUCM node",
      ),
  }),
  async handler(params, pool) {
    const result = await traceCdr(pool, params.call_id, params.callmanager_id);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
};
