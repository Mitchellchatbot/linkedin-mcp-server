import express from "express";
import session from "express-session";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

import {
  generateAuthUrl,
  generateState,
  exchangeCodeForToken,
  storeToken,
  getToken,
  setGlobalToken,
  getGlobalToken,
  TokenData,
} from "./auth.js";
import {
  getProfile,
  createPost,
  getMyPosts,
  searchJobs,
  getConnections,
  searchPeople,
} from "./linkedin.js";

// ── Config ──────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3000", 10);
const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || "";
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-me-in-production";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const REDIRECT_URI = `${BASE_URL}/auth/callback`;

// If you already have a long-lived access token, set it here to skip OAuth
if (process.env.LINKEDIN_ACCESS_TOKEN) {
  setGlobalToken(process.env.LINKEDIN_ACCESS_TOKEN);
  console.log("[auth] Loaded access token from environment");
}

// ── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: BASE_URL.startsWith("https"), maxAge: 3600000 },
  })
);

// Extend session type
declare module "express-session" {
  interface SessionData {
    oauthState?: string;
    linkedinToken?: TokenData;
  }
}

// ── Helper: resolve token for a request ─────────────────────────────────────

function resolveToken(req: express.Request): string {
  const global = getGlobalToken();
  if (global) return global.accessToken;

  const sessionToken = req.session.linkedinToken;
  if (sessionToken && Date.now() < sessionToken.expiresAt) {
    return sessionToken.accessToken;
  }
  throw new McpError(
    ErrorCode.InvalidRequest,
    "Not authenticated. Visit /auth/login to connect your LinkedIn account."
  );
}

// ── OAuth routes ─────────────────────────────────────────────────────────────

app.get("/auth/login", (req, res) => {
  if (!CLIENT_ID) {
    res.status(500).send("LINKEDIN_CLIENT_ID is not configured.");
    return;
  }
  const state = generateState();
  req.session.oauthState = state;
  const authUrl = generateAuthUrl(CLIENT_ID, REDIRECT_URI, state);
  res.redirect(authUrl);
});

app.get("/auth/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query as Record<string, string>;

  if (error) {
    res.status(400).send(`LinkedIn auth error: ${error_description || error}`);
    return;
  }

  if (state !== req.session.oauthState) {
    res.status(400).send("Invalid OAuth state — possible CSRF. Please try again.");
    return;
  }

  try {
    const { accessToken, expiresIn } = await exchangeCodeForToken(
      CLIENT_ID,
      CLIENT_SECRET,
      REDIRECT_URI,
      code
    );
    const tokenData: TokenData = {
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    req.session.linkedinToken = tokenData;
    // Also set as global so MCP tools can use it without passing session
    setGlobalToken(accessToken, expiresIn);
    res.send(`
      <html><body style="font-family:sans-serif;padding:2rem">
        <h2>✅ LinkedIn Connected!</h2>
        <p>Your LinkedIn account is now linked to Claude. You can close this tab.</p>
        <p><small>Token expires in ${Math.round(expiresIn / 3600)} hours.</small></p>
      </body></html>
    `);
  } catch (err: any) {
    console.error("Token exchange failed:", err.response?.data || err.message);
    res.status(500).send(`Token exchange failed: ${err.message}`);
  }
});

app.get("/auth/status", (req, res) => {
  const global = getGlobalToken();
  const session = req.session.linkedinToken;
  const token = global || session;

  if (token && Date.now() < token.expiresAt) {
    res.json({
      authenticated: true,
      expiresAt: new Date(token.expiresAt).toISOString(),
    });
  } else {
    res.json({ authenticated: false, loginUrl: `${BASE_URL}/auth/login` });
  }
});

// ── MCP Server factory ───────────────────────────────────────────────────────

function createMcpServer(): Server {
  const server = new Server(
    { name: "linkedin-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  // ── Tool definitions ──────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "linkedin_get_profile",
        description:
          "Get your LinkedIn profile information including name, headline, email, and profile picture URL.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "linkedin_create_post",
        description:
          "Create a new public LinkedIn post with the given text content.",
        inputSchema: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "The text content of the post (max 3000 chars).",
            },
          },
          required: ["text"],
        },
      },
      {
        name: "linkedin_get_my_posts",
        description: "Retrieve your recent LinkedIn posts.",
        inputSchema: {
          type: "object",
          properties: {
            count: {
              type: "number",
              description: "Number of posts to retrieve (default 10, max 50).",
            },
          },
          required: [],
        },
      },
      {
        name: "linkedin_search_jobs",
        description: "Search for job listings on LinkedIn.",
        inputSchema: {
          type: "object",
          properties: {
            keywords: {
              type: "string",
              description: "Job title, skills, or keywords to search for.",
            },
            location: {
              type: "string",
              description: "Location to search in (optional).",
            },
            count: {
              type: "number",
              description: "Number of results to return (default 10).",
            },
          },
          required: ["keywords"],
        },
      },
      {
        name: "linkedin_get_connections",
        description: "Get a list of your 1st-degree LinkedIn connections.",
        inputSchema: {
          type: "object",
          properties: {
            count: {
              type: "number",
              description: "Number of connections to fetch (default 20).",
            },
          },
          required: [],
        },
      },
      {
        name: "linkedin_search_people",
        description: "Search for LinkedIn members by name, title, or company.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Name, job title, or keywords to search for.",
            },
            count: {
              type: "number",
              description: "Number of results (default 10).",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "linkedin_auth_status",
        description:
          "Check whether your LinkedIn account is connected and the token is valid.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
    ],
  }));

  // ── Tool execution ────────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args = {} } = request.params;

    // Auth status doesn't need a token
    if (name === "linkedin_auth_status") {
      const token = getGlobalToken();
      if (token) {
        return {
          content: [
            {
              type: "text",
              text: `✅ LinkedIn is connected. Token expires at ${new Date(token.expiresAt).toISOString()}.`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `❌ Not connected. Visit ${BASE_URL}/auth/login to authenticate with LinkedIn.`,
          },
        ],
      };
    }

    // All other tools need a valid token
    let accessToken: string;
    try {
      // We don't have the request object here in MCP handler, use global token
      const token = getGlobalToken();
      if (!token) {
        return {
          content: [
            {
              type: "text",
              text: `Not authenticated. Visit ${BASE_URL}/auth/login to connect your LinkedIn account.`,
            },
          ],
          isError: true,
        };
      }
      accessToken = token.accessToken;
    } catch (err: any) {
      return {
        content: [{ type: "text", text: err.message }],
        isError: true,
      };
    }

    try {
      switch (name) {
        case "linkedin_get_profile": {
          const profile = await getProfile(accessToken);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    id: profile.id,
                    name: `${profile.firstName} ${profile.lastName}`,
                    headline: profile.headline,
                    email: profile.email,
                    profilePicture: profile.profilePicture,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "linkedin_create_post": {
          const text = String(args.text || "").slice(0, 3000);
          if (!text.trim()) {
            return {
              content: [{ type: "text", text: "Post text cannot be empty." }],
              isError: true,
            };
          }
          const profile = await getProfile(accessToken);
          const postId = await createPost(
            accessToken,
            text,
            `urn:li:person:${profile.id}`
          );
          return {
            content: [
              {
                type: "text",
                text: `✅ Post published successfully! Post ID: ${postId}`,
              },
            ],
          };
        }

        case "linkedin_get_my_posts": {
          const count = Math.min(Number(args.count) || 10, 50);
          const profile = await getProfile(accessToken);
          const posts = await getMyPosts(
            accessToken,
            `urn:li:person:${profile.id}`,
            count
          );
          return {
            content: [
              {
                type: "text",
                text:
                  posts.length === 0
                    ? "No posts found."
                    : JSON.stringify(
                        posts.map((p) => ({
                          id: p.id,
                          text: p.text,
                          createdAt: new Date(p.createdAt).toISOString(),
                        })),
                        null,
                        2
                      ),
              },
            ],
          };
        }

        case "linkedin_search_jobs": {
          const keywords = String(args.keywords || "");
          const location = args.location ? String(args.location) : undefined;
          const count = Number(args.count) || 10;
          const jobs = await searchJobs(accessToken, keywords, location, count);
          return {
            content: [
              {
                type: "text",
                text:
                  jobs.length === 0
                    ? "No jobs found."
                    : JSON.stringify(jobs, null, 2),
              },
            ],
          };
        }

        case "linkedin_get_connections": {
          const count = Number(args.count) || 20;
          const connections = await getConnections(accessToken, count);
          return {
            content: [
              {
                type: "text",
                text:
                  connections.length === 0
                    ? "No connections found (this feature may require elevated API access)."
                    : JSON.stringify(connections, null, 2),
              },
            ],
          };
        }

        case "linkedin_search_people": {
          const query = String(args.query || "");
          const count = Number(args.count) || 10;
          const people = await searchPeople(accessToken, query, count);
          return {
            content: [
              {
                type: "text",
                text:
                  people.length === 0
                    ? "No people found."
                    : JSON.stringify(people, null, 2),
              },
            ],
          };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (err: any) {
      const message =
        err instanceof McpError
          ? err.message
          : err.response?.data?.message || err.message || String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// ── SSE MCP endpoint ──────────────────────────────────────────────────────────

// Track active SSE transports so we can route POST messages
const activeTransports = new Map<string, SSEServerTransport>();

app.get("/mcp/sse", async (req, res) => {
  console.log("[mcp] New SSE connection");
  const transport = new SSEServerTransport("/mcp/messages", res);
  const sessionId = transport.sessionId;
  activeTransports.set(sessionId, transport);

  const server = createMcpServer();
  await server.connect(transport);

  res.on("close", () => {
    console.log(`[mcp] SSE connection closed: ${sessionId}`);
    activeTransports.delete(sessionId);
  });
});

app.post("/mcp/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = activeTransports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  await transport.handlePostMessage(req, res);
});

// ── Health & info ─────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.json({
    name: "LinkedIn MCP Server",
    version: "1.0.0",
    status: "running",
    endpoints: {
      mcp_sse: `${BASE_URL}/mcp/sse`,
      auth_login: `${BASE_URL}/auth/login`,
      auth_status: `${BASE_URL}/auth/status`,
      health: `${BASE_URL}/health`,
    },
    instructions: {
      step1: `Visit ${BASE_URL}/auth/login to connect your LinkedIn account`,
      step2: `Add MCP server in Claude with URL: ${BASE_URL}/mcp/sse`,
    },
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀 LinkedIn MCP Server running on port ${PORT}`);
  console.log(`   Home:        ${BASE_URL}/`);
  console.log(`   MCP SSE:     ${BASE_URL}/mcp/sse`);
  console.log(`   Auth login:  ${BASE_URL}/auth/login`);
  console.log(`   Auth status: ${BASE_URL}/auth/status\n`);
});
