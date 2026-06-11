# Look At Pic MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP server with HTTP+SSE transport that exposes a single `vision_query` tool using GLM-4V multimodal LLM.

**Architecture:** Single-file TypeScript Express server. Reads `config.json` for API credentials, registers `vision_query` tool via `@modelcontextprotocol/sdk`, delegates vision requests to GLM-4V via OpenAI-compatible API.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` 1.29.0, Express, OpenAI SDK, tsx runtime

---

### Task 1: Project Scaffolding

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `config.json`
- Create: `README.md`

- [ ] **Step 1: Git init**

```bash
cd /home/deck/.openclaw/workspace/projects/collab/look_at_pic_mcp
git init
```

- [ ] **Step 2: Create .gitignore**

```gitignore
node_modules/
dist/
config.json
```

- [ ] **Step 3: Create package.json**

```json
{
  "name": "look-at-pic-mcp",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "express": "^4.21.0",
    "openai": "^4.73.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

Dependency rationale:
- `@modelcontextprotocol/sdk` — MCP server + StreamableHTTP transport
- `express` — HTTP server (required by StreamableHTTPServerTransport for Node.js)
- `openai` — OpenAI-compatible client to call GLM-4V
- `zod` — schema validation for tool input (MCP SDK requires zod schemas)
- `tsx` — TypeScript executor (no build step needed)
- `@types/express`, `@types/node` — TypeScript type definitions

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create config.json**

```json
{
  "api_key": "c9ba715dc64a4db894189bc735ffe3a8.vIU7ddK8aKpnZZXc",
  "model": "glm-4v",
  "api_base": "https://open.bigmodel.cn/api/paas/v4/",
  "port": 3100
}
```

- [ ] **Step 6: Create README.md**

```markdown
# Look At Pic MCP

MCP server providing image recognition via GLM-4V multimodal model.

## Tool

### `vision_query`

Analyze an image using GLM-4V.

**Parameters:**
- `image_url` (string, optional): HTTP/HTTPS URL of the image
- `image_base64` (string, optional): Base64-encoded image data
- `prompt` (string, optional): Custom question about the image. If omitted, returns exhaustive description.

## Configuration

Edit `config.json`:

```json
{
  "api_key": "your-glm-api-key",
  "model": "glm-4v",
  "api_base": "https://open.bigmodel.cn/api/paas/v4/",
  "port": 3100
}
```

## Usage

```bash
npm install
npm start
```

Server runs at `http://localhost:3100/mcp` (SSE endpoint for MCP clients).
```

- [ ] **Step 7: Commit**

```bash
git add .gitignore package.json tsconfig.json config.json README.md
git commit -m "chore: project scaffolding"
```

---

### Task 2: Main Server Implementation

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Create src/index.ts with all imports and constants**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import OpenAI from "openai";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load config
const configPath = join(__dirname, "..", "config.json");
let config: { api_key: string; model: string; api_base: string; port: number };
try {
  config = JSON.parse(readFileSync(configPath, "utf-8"));
} catch (e) {
  console.error("Failed to read config.json:", e);
  process.exit(1);
}

// Create OpenAI client pointed at GLM
const client = new OpenAI({
  apiKey: config.api_key,
  baseURL: config.api_base,
});

// Built-in system prompt for exhaustive image description
const IMAGE_ANALYSIS_SYSTEM_PROMPT = [
  "You are an image analysis subagent. Your only job: look at the attached image and describe everything visible in precise detail.",
  "",
  "What to describe:",
  "- Text content: every word, label, heading, code snippet visible in the image",
  "- UI elements: buttons, menus, dialogs, tabs, input fields, window decorations",
  "- Layout: spatial arrangement, alignment, grouping, whitespace patterns",
  "- Visual style: colors, fonts (serif/sans-serif/monospace), icons, themes (light/dark)",
  "- Diagrams and charts: axes, legends, data points, relationships, flow directions",
  "- Code and terminal output: exact content, syntax highlighting colors, line numbers, prompts",
  "- Context clues: application name in title bar, OS window decorations, file paths, timestamps",
  "- Colored boxes and frames: pay special attention to any colored borders, highlighted regions, selection boxes, or colored overlays — these are often intentional visual cues added to draw attention to specific areas and must be described explicitly with their color, position, and approximate size",
  "",
  "Rules:",
  "- Be exhaustive, not concise. Every detail matters.",
  "- Describe spatial positions explicitly (top-left, bottom-right, centered, etc.).",
  "- Match the language of the requesting instruction.",
  "- Output raw description directly, no preamble or meta-commentary.",
  "- If the image is unclear or ambiguous, state what you can see and what is uncertain.",
  "- If the image is cropped, truncated, or partially obscured, explicitly note which parts are missing or at what boundaries the content is cut off.",
  "- Do NOT suggest next steps or ask follow-up questions — just describe.",
].join("\n");

// Create MCP server with stateless transport
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});

const server = new McpServer({
  name: "look-at-pic",
  version: "1.0.0",
});

// Register vision_query tool
server.registerTool(
  "vision_query",
  {
    description: "对图片进行理解和分析，支持 URL 或 base64 输入。不传 prompt 时返回详尽的图片描述。",
    inputSchema: {
      image_url: z.string().url().optional().describe("图片的 HTTP/HTTPS URL"),
      image_base64: z.string().optional().describe("图片的 base64 编码字符串"),
      prompt: z.string().optional().describe("针对图片的自定义提问。不传则使用内置 prompt 做详尽描述"),
    },
  },
  async (args) => {
    const { image_url, image_base64, prompt } = args;

    // Validate: must provide either image_url or image_base64
    if (!image_url && !image_base64) {
      return {
        content: [{ type: "text" as const, text: "必须提供 image_url 或 image_base64 参数" }],
        isError: true,
      };
    }

    // Build image content — image_url takes priority if both provided
    const imageSource = image_url || `data:image/png;base64,${image_base64}`;

    // Build messages based on whether custom prompt is provided
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    if (!prompt) {
      // Default mode: use system prompt for exhaustive description
      messages.push({
        role: "system",
        content: IMAGE_ANALYSIS_SYSTEM_PROMPT,
      });
      messages.push({
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageSource } },
          { type: "text", text: "请描述这张图片" },
        ],
      });
    } else {
      // Custom prompt mode: no system prompt, user controls semantics
      messages.push({
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageSource } },
          { type: "text", text: prompt },
        ],
      });
    }

    try {
      const response = await client.chat.completions.create({
        model: config.model,
        messages,
        max_tokens: 4096,
      });

      const text = response.choices[0]?.message?.content ?? "";

      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `GLM API 调用失败: ${message}` }],
        isError: true,
      };
    }
  }
);

// Setup Express + MCP transport
async function main() {
  const app = express();

  // Express 5 + body-parser style: parse JSON body
  app.use(express.json());

  // Handle all MCP requests (GET for SSE, POST for messages, DELETE for session)
  app.all("/mcp", async (req, res) => {
    await transport.handleRequest(req, res, req.body);
  });

  await server.connect(transport);

  app.listen(config.port, () => {
    console.log(`Look At Pic MCP server running at http://localhost:${config.port}/mcp`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Create src/ directory and commit**

```bash
mkdir -p src
git add src/index.ts
git commit -m "feat: implement vision_query MCP tool with HTTP+SSE transport"
```

---

### Task 3: Install Dependencies and Smoke Test

- [ ] **Step 1: Install dependencies**

```bash
npm install
```

Expected: all packages install without errors.

- [ ] **Step 2: Start the server**

```bash
npx tsx src/index.ts &
SERVER_PID=$!
sleep 2
```

Expected: `Look At Pic MCP server running at http://localhost:3100/mcp`

- [ ] **Step 3: Test tools/list via curl**

```bash
curl -s -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Expected: JSON-RPC response listing `vision_query` tool with its schema. Response should contain `"name":"vision_query"`.

- [ ] **Step 4: Test tools/call with a known image URL**

```bash
curl -s -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"vision_query","arguments":{"image_url":"https://httpbin.org/image/png","prompt":"What do you see in this image?"}}}'
```

Expected: JSON-RPC response with `content` array containing GLM-4V's image description text.

- [ ] **Step 5: Test parameter validation (missing image)**

```bash
curl -s -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"vision_query","arguments":{}}}'
```

Expected: `isError: true` with message "必须提供 image_url 或 image_base64 参数"

- [ ] **Step 6: Stop server and commit**

```bash
kill $SERVER_PID
```

No commit needed unless fixes were applied.
