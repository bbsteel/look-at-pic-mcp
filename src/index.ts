import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import OpenAI from "openai";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load config
const configPath = join(__dirname, "..", "config.json");
let config: { api_key: string; model: string; api_base: string };
try {
  config = JSON.parse(readFileSync(configPath, "utf-8"));
} catch (e) {
  console.error("读取 config.json 失败:", e);
  process.exit(1);
}

// Create OpenAI client pointed at GLM
const client = new OpenAI({
  apiKey: config.api_key,
  baseURL: config.api_base,
  timeout: 60000,
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

const server = new McpServer({
  name: "look-at-pic",
  version: "1.0.0",
});

// Register vision_query tool
server.registerTool(
  "vision_query",
  {
    description: "对图片进行理解和分析，支持 base64 或本地文件路径输入。不传 prompt 时返回详尽的图片描述。",
    inputSchema: {
      image_base64: z.string().optional().describe("图片的 base64 编码字符串，或完整的 data: URI（如 data:image/jpeg;base64,...）"),
      image_path: z.string().optional().describe("图片的本地文件路径（绝对路径或相对路径）"),
      prompt: z.string().optional().describe("针对图片的自定义提问。不传则使用内置 prompt 做详尽描述"),
    },
  },
  async (args) => {
    const { image_base64, image_path, prompt } = args;

    // Validate: must provide at least one of image_base64, image_path
    if (!image_base64 && !image_path) {
      return {
        content: [{ type: "text" as const, text: "必须提供 image_base64 或 image_path 参数" }],
        isError: true,
      };
    }

    // Build image content — image_path takes priority over image_base64
    let imageSource: string;
    if (image_path) {
      const resolvedPath = resolve(image_path);
      if (!existsSync(resolvedPath)) {
        return {
          content: [{ type: "text" as const, text: `文件不存在: ${resolvedPath}` }],
          isError: true,
        };
      }
      try {
        const imgBytes = readFileSync(resolvedPath);
        const ext = extname(resolvedPath).toLowerCase();
        const mimeMap: Record<string, string> = {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".gif": "image/gif",
          ".webp": "image/webp",
          ".bmp": "image/bmp",
        };
        const mime = mimeMap[ext] || "image/png";
        const b64 = imgBytes.toString("base64");
        imageSource = `data:${mime};base64,${b64}`;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `读取文件失败: ${msg}` }],
          isError: true,
        };
      }
    } else {
      imageSource = image_base64!.startsWith("data:") ? image_base64! : `data:image/png;base64,${image_base64!}`;
    }

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

// Start MCP server with stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
