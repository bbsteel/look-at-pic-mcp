# Look At Pic MCP — Design Spec

## Overview

一个 MCP Server，通过 GLM-4V 多模态大模型提供图片识别能力。对外暴露单一工具 `vision_query`，支持 URL 和 base64 两种图片输入方式。

## Decisions

| 决策 | 选择 | 原因 |
|------|------|------|
| 传输方式 | HTTP + SSE (StreamableHTTP) | 不使用 stdio，避免鉴权泄漏 |
| 开发语言 | TypeScript | 用户偏好 |
| 工具数量 | 1 个 (`vision_query`) | 功能简单，不需要拆分 |
| 图片传入 | URL 或 base64，二选一 | 保持灵活性 |
| API Key | `config.json` 文件 | 不依赖环境变量，方便部署 |
| LLM | GLM-4V (`glm-4v`) | 通过 OpenAI 兼容接口调用 |

## Project Structure

```
look_at_pic_mcp/
├── package.json
├── tsconfig.json
├── config.json              # API Key + 模型配置
├── src/
│   └── index.ts             # MCP Server 主文件
└── README.md
```

### config.json

```json
{
  "api_key": "your-glm-api-key",
  "model": "glm-4v",
  "api_base": "https://open.bigmodel.cn/api/paas/v4/",
  "port": 3100
}
```

所有字段必填。`api_key` 为智谱 API Key，`model` 默认 `glm-4v`，`api_base` 指向智谱 OpenAI 兼容端点，`port` 为 HTTP 监听端口。

## Tool: `vision_query`

### Description

对图片进行理解和分析，支持 URL 或 base64 输入。不传 `prompt` 时使用内置 system prompt 进行详尽的全图描述。

### Input Schema

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `image_url` | string | 与 `image_base64` 二选一 | 图片的 HTTP/HTTPS URL |
| `image_base64` | string | 与 `image_url` 二选一 | 图片的 base64 编码字符串 |
| `prompt` | string | 否 | 自定义提问内容。不传则使用内置 prompt 做详尽描述 |

### 内置 System Prompt

当用户不传 `prompt` 时，使用以下 system prompt：

```
You are an image analysis subagent. Your only job: look at the attached image and describe everything visible in precise detail.

What to describe:
- Text content: every word, label, heading, code snippet visible in the image
- UI elements: buttons, menus, dialogs, tabs, input fields, window decorations
- Layout: spatial arrangement, alignment, grouping, whitespace patterns
- Visual style: colors, fonts (serif/sans-serif/monospace), icons, themes (light/dark)
- Diagrams and charts: axes, legends, data points, relationships, flow directions
- Code and terminal output: exact content, syntax highlighting colors, line numbers, prompts
- Context clues: application name in title bar, OS window decorations, file paths, timestamps
- Colored boxes and frames: pay special attention to any colored borders, highlighted regions, selection boxes, or colored overlays — these are often intentional visual cues added to draw attention to specific areas and must be described explicitly with their color, position, and approximate size

Rules:
- Be exhaustive, not concise. Every detail matters.
- Describe spatial positions explicitly (top-left, bottom-right, centered, etc.).
- Match the language of the requesting instruction.
- Output raw description directly, no preamble or meta-commentary.
- If the image is unclear or ambiguous, state what you can see and what is uncertain.
- If the image is cropped, truncated, or partially obscured, explicitly note which parts are missing or at what boundaries the content is cut off.
- Do NOT suggest next steps or ask follow-up questions — just describe.
```

相对于原始 prompt，增加了"裁剪/遮挡"规则。

### 自定义 Prompt 模式

当用户传入 `prompt` 时，作为 user message 直接发送给模型（不使用 system prompt），由用户完全控制交互语义。

## Data Flow

```
MCP Client (HTTP POST with JSON-RPC)
  │
  ▼
Express Server (port 3100)
  │
  ▼
MCP StreamableHTTPServerTransport
  │  ┌─ tools/list → [vision_query]
  │  └─ tools/call → handleVisionQuery()
  │                    │
  │                    ├─ 校验参数 (url/base64 二选一)
  │                    ├─ 读取 config.json 获取 api_key / model / api_base
  │                    ├─ 构建 OpenAI vision API 请求
  │                    │    ├─ model: config.model
  │                    │    ├─ messages:
  │                    │    │    ├─ system: 内置 prompt (仅当无自定义 prompt)
  │                    │    │    └─ user: [{type: "image_url", image_url: {url: ...}}]
  │                    │    │       或 [{type: "image_url", image_url: {url: "data:..."}}]
  │                    │    └─ max_tokens: 4096
  │                    ├─ fetch → GLM API
  │                    └─ 返回 content 文本
  │
  ▼
MCP Client (JSON-RPC response)
```

## GLM-4V API 调用

GLM-4V 兼容 OpenAI 的 `/chat/completions` 接口。

**Endpoint:** `{api_base}/chat/completions`

**认证:** `Authorization: Bearer {api_key}`

**请求体示例 (URL):**
```json
{
  "model": "glm-4v",
  "messages": [
    {
      "role": "system",
      "content": "...内置 prompt..."
    },
    {
      "role": "user",
      "content": [
        { "type": "image_url", "image_url": { "url": "https://example.com/image.png" } },
        { "type": "text", "text": "请描述这张图片" }
      ]
    }
  ],
  "max_tokens": 4096
}
```

**请求体示例 (base64):**
```json
{
  "model": "glm-4v",
  "messages": [
    {
      "role": "system",
      "content": "...内置 prompt..."
    },
    {
      "role": "user",
      "content": [
        { "type": "image_url", "image_url": { "url": "data:image/png;base64,iVBORw0KGgo..." } }
      ]
    }
  ],
  "max_tokens": 4096
}
```

## Error Handling

| 场景 | 行为 |
|------|------|
| `config.json` 不存在 | 启动时 `console.error` 并 `process.exit(1)` |
| 既没传 `image_url` 也没传 `image_base64` | 返回 MCP error: "必须提供 image_url 或 image_base64" |
| 同时传了 `image_url` 和 `image_base64` | `image_url` 优先，忽略 `image_base64` |
| GLM API 调用失败 | 返回 MCP error，包含 API 返回的错误信息 |
| `prompt` 为空字符串 | 视为不传，使用内置 prompt |

## Dependencies

- `@modelcontextprotocol/sdk` — MCP Server + StreamableHTTP transport
- `openai` — OpenAI 兼容客户端（调用 GLM API）
- `express` — HTTP 服务器（MCP SDK StreamableHTTP 依赖）
- `typescript` + `tsx` — 编译和运行

## Not In Scope

- 多工具（只有 `vision_query` 一个）
- 图片预处理/压缩/格式转换
- 鉴权中间件（MCP server 本身不设防，依赖部署层面的网络安全）
- 日志系统（console.log 即可）
- Docker 化
- 多模型切换（配置里改 `model` 字段即可，不需要代码支持）
