# Look At Pic MCP

MCP server providing image recognition via an OpenAI-compatible multimodal vision model.

## Tool

### `vision_query`

Analyze an image using a configured multimodal vision model.

**Parameters:**
- `image_path` (string, optional): Local file path (absolute or relative)
- `image_base64` (string, optional): Base64-encoded image data, or full data: URI
- `prompt` (string, optional): Custom question about the image. If omitted, returns exhaustive description.

## Configuration

Edit `config.json`:

```json
{
  "api_key": "your-api-key",
  "model": "your-vision-model",
  "api_base": "https://your-openai-compatible-api.example/v1"
}
```

## Usage

Install dependencies (pick one):

```bash
bun install
# or
npm install
```

Stdio MCP server — configure your MCP client to spawn this process.

**Using bun:**

```json
{
  "mcpServers": {
    "look-at-pic": {
      "command": "bun",
      "args": ["run", "/path/to/look_at_pic_mcp/index.ts"]
    }
  }
}
```

**Using tsx (Node.js):**

```json
{
  "mcpServers": {
    "look-at-pic": {
      "command": "npx",
      "args": ["tsx", "index.ts"],
      "cwd": "/path/to/look_at_pic_mcp"
    }
  }
}
```
