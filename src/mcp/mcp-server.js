const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");

async function createMcpServer(app, pool) {
  const server = new McpServer({
    name: "cisco-cdr",
    version: "0.1.0",
  });

  // Register all tools
  const tools = [
    require("./tools/cdr-search"),
    require("./tools/cdr-trace"),
    require("./tools/cdr-quality"),
    require("./tools/cdr-stats"),
    require("./tools/cdr-health"),
  ];

  for (const tool of tools) {
    // MCP SDK expects ZodRawShape (the .shape property), not z.object() wrapper
    const schema = tool.inputSchema.shape
      ? tool.inputSchema.shape
      : tool.inputSchema;
    server.tool(tool.name, tool.description, schema, async (params) => {
      return tool.handler(params, pool);
    });
  }

  // Mount streamable HTTP transport on Express
  // Stateless mode: each POST creates a fresh transport instance
  app.post("/mcp", async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("MCP request error:", err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "MCP server error" });
      }
    }
  });

  app.get("/mcp", (req, res) => {
    res.writeHead(405).end("Method Not Allowed");
  });

  app.delete("/mcp", (req, res) => {
    res.writeHead(405).end("Method Not Allowed");
  });

  return server;
}

module.exports = { createMcpServer };
