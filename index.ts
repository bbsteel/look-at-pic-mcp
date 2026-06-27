import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import OpenAI from "openai";
import { readFileSync, existsSync, appendFileSync, statSync } from "node:fs";
import { join, dirname, extname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));

const LOG_FILE = join(tmpdir(), "look-at-pic-mcp.log");
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

export function getImageMimeForPath(filePath: string) {
  const ext = extname(filePath).toLowerCase();
  return IMAGE_MIME_BY_EXTENSION[ext];
}

export function isImageFileTooLarge(fileSize: number) {
  return fileSize > MAX_IMAGE_BYTES;
}

export function getBase64PayloadLength(input: string) {
  if (!input.startsWith("data:")) {
    return input.length;
  }

  const commaIndex = input.indexOf(",");
  return commaIndex === -1 ? 0 : input.length - commaIndex - 1;
}

type VisionQueryArgs = {
  image_base64?: string;
  image_path?: string;
  prompt?: string;
};

type TextToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function createTextResult(text: string, isError = false): TextToolResult {
  return {
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
  };
}

export function createModelTextResult(text: string): TextToolResult {
  if (text.trim().length === 0) {
    return createTextResult("Vision model API returned empty response text", true);
  }

  return createTextResult(text);
}

function buildInputDescription({ image_base64, image_path }: VisionQueryArgs) {
  if (image_path) {
    return `path:${image_path}`;
  }

  if (image_base64) {
    return `base64:${image_base64.slice(0, 10)}...`;
  }

  return "none";
}

function buildImageSourceFromPath(imagePath: string): { imageSource: string } | { error: TextToolResult } {
  const resolvedPath = resolve(imagePath);
  if (!existsSync(resolvedPath)) {
    return { error: createTextResult(`File not found: ${resolvedPath}`, true) };
  }

  const mime = getImageMimeForPath(resolvedPath);
  if (!mime) {
    const ext = extname(resolvedPath).toLowerCase();
    return { error: createTextResult(`Unsupported image file extension: ${ext || "(none)"}`, true) };
  }

  const fileSize = statSync(resolvedPath).size;
  if (isImageFileTooLarge(fileSize)) {
    return {
      error: createTextResult(
        `Image file is too large: ${fileSize} bytes. Maximum allowed size is ${MAX_IMAGE_BYTES} bytes.`,
        true,
      ),
    };
  }

  const imgBytes = readFileSync(resolvedPath);
  const b64 = imgBytes.toString("base64");
  return { imageSource: `data:${mime};base64,${b64}` };
}

function buildImageSourceFromBase64(imageBase64: string): { imageSource: string } | { error: TextToolResult } {
  const base64Length = getBase64PayloadLength(imageBase64);
  if (base64Length > MAX_IMAGE_BASE64_LENGTH) {
    return {
      error: createTextResult(
        `Base64 image data is too large: ${base64Length} characters. Maximum allowed length is ${MAX_IMAGE_BASE64_LENGTH} characters for a ${MAX_IMAGE_BYTES} byte image.`,
        true,
      ),
    };
  }

  return {
    imageSource: imageBase64.startsWith("data:") ? imageBase64 : `data:image/png;base64,${imageBase64}`,
  };
}

function buildMessages(imageSource: string, prompt?: string): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  if (!prompt) {
    return [
      {
        role: "system",
        content: IMAGE_ANALYSIS_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageSource } },
          { type: "text", text: "Please describe this image." },
        ],
      },
    ];
  }

  return [
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageSource } },
        { type: "text", text: prompt },
      ],
    },
  ];
}

function isMainModule() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { appendFileSync(LOG_FILE, line); } catch {}
}

// Load config
const configPath = join(__dirname, "config.json");
let config: { api_key: string; model: string; api_base: string };
try {
  config = JSON.parse(readFileSync(configPath, "utf-8"));
} catch (e) {
  console.error("Failed to load config.json:", e);
  process.exit(1);
}

// Create OpenAI-compatible client for the configured multimodal model API.
const client = new OpenAI({
  apiKey: config.api_key,
  baseURL: config.api_base,
  timeout: 300000,
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
  version: "1.0.1",
});

async function handleVisionQuery(args: VisionQueryArgs): Promise<TextToolResult> {
  const { image_base64, image_path, prompt } = args;
  const t0 = Date.now();
  const inputDesc = buildInputDescription(args);

  if (!image_base64 && !image_path) {
    log(`vision_query | input=${inputDesc} | status=error | Must provide image_base64 or image_path`);
    return createTextResult("Must provide image_base64 or image_path", true);
  }

  let imageResult: { imageSource: string } | { error: TextToolResult };
  try {
    imageResult = image_path
      ? buildImageSourceFromPath(image_path)
      : buildImageSourceFromBase64(image_base64!);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`vision_query | input=${inputDesc} | status=error | ${message} | ${Date.now() - t0}ms`);
    return createTextResult(`Failed to read file: ${message}`, true);
  }

  if ("error" in imageResult) {
    return imageResult.error;
  }

  try {
    const response = await client.chat.completions.create({
      model: config.model,
      messages: buildMessages(imageResult.imageSource, prompt),
      max_tokens: 4096,
    });

    const text = response.choices[0]?.message?.content ?? "";

    const result = createModelTextResult(text);
    log(`vision_query | input=${inputDesc} | status=${result.isError ? "error" : "ok"} | ${Date.now() - t0}ms`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`vision_query | input=${inputDesc} | status=error | ${message} | ${Date.now() - t0}ms`);
    return createTextResult(`Vision model API error: ${message}`, true);
  }
}

// Register vision_query tool
server.registerTool(
  "vision_query",
  {
    description: "Analyze an image using a multimodal vision model. Accepts a local file path or base64 data. Omit prompt for an exhaustive description.",
    inputSchema: {
      image_base64: z.string().optional().describe("Base64-encoded image string, or a full data: URI (e.g. data:image/jpeg;base64,...)"),
      image_path: z.string().optional().describe("Local file path to the image (absolute or relative)"),
      prompt: z.string().optional().describe("Question about the image. Omit to get a detailed description using the built-in prompt."),
    },
  },
  handleVisionQuery
);

// Start MCP server with stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (isMainModule()) {
  main().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
