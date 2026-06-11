# Look At Pic MCP

MCP server providing image recognition via GLM-4V multimodal model.

## Tool

### `vision_query`

Analyze an image using GLM-4V.

**Parameters:**
- `image_url` (string, optional): HTTP/HTTPS URL of the image
- `image_base64` (string, optional): Base64-encoded image data, or full data: URI
- `prompt` (string, optional): Custom question about the image. If omitted, returns exhaustive description.

## Configuration

Edit `config.json`:

```json
{
  "api_key": "your-glm-api-key",
  "model": "glm-4v",
  "api_base": "https://open.bigmodel.cn/api/paas/v4/"
}
```

## Usage

```bash
npm install
```

Stdio MCP server — configure your MCP client to spawn this process:

```json
{
  "mcpServers": {
    "look-at-pic": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/path/to/look_at_pic_mcp"
    }
  }
}
```
