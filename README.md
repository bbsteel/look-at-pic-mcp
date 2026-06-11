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
