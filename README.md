# iconscout-mcp

MCP server for the [Iconscout API](https://iconscout.com/api): search and download icons, illustrations, 3D assets and Lottie animations directly from an AI agent.

## Setup

Get API credentials at [iconscout.com/api](https://iconscout.com/api), then set environment variables:

```
ICONSCOUT_CLIENT_ID=your-client-id
ICONSCOUT_CLIENT_SECRET=your-client-secret
ICONSCOUT_DOWNLOAD_DIR=optional-default-save-dir
```

Build:

```bash
git clone https://github.com/ReverserID/iconscout-mcp.git
cd iconscout-mcp
npm install
npm run build   # esbuild main.ts -> main.js
```

Claude Code:

```bash
claude mcp add iconscout -e ICONSCOUT_CLIENT_ID=xxx -e ICONSCOUT_CLIENT_SECRET=yyy -- node /path/to/iconscout-mcp/main.js
```

Any MCP client (stdio):

```json
{
  "mcpServers": {
    "iconscout": {
      "command": "node",
      "args": ["/path/to/iconscout-mcp/main.js"],
      "env": {
        "ICONSCOUT_CLIENT_ID": "xxx",
        "ICONSCOUT_CLIENT_SECRET": "yyy"
      }
    }
  }
}
```

## Tools

### `search_assets`

| Param | Default | Description |
|-------|---------|-------------|
| `query` | — | Search query |
| `asset` | `icon` | `icon`, `illustration`, `3d`, `lottie`, `all` |
| `price` | `all` | `all`, `free`, `premium` |
| `sort` | `relevant` | `relevant`, `latest`, `popular`, `color` |
| `page` | 1 | Result page |
| `limit` | 10 | Results per page (1–50) |
| `styles` | — | Comma-separated style filter |

Returns name, uuid, price and preview URL per result.

### `get_asset`

Item details by `uuid`: type, price, preview, slug, web page.

### `preview_asset`

Fetches the item's PNG thumbnail and returns it as MCP image content — the agent sees the icon before spending a download credit. Lottie items return the video thumb URL instead.

### `download_asset`

| Param | Default | Description |
|-------|---------|-------------|
| `uuid` | — | Item uuid |
| `format` | `svg` | `svg`, `png`, `pdf`, `eps`, `ai` (icons/illustrations); `json`, `gif`, `mp4` (lottie); `fbx`, `glb`, `obj` (3d) |
| `saveDir` | `./iconscout-downloads` | Save directory |
| `fileName` | item name | File name override |

Downloads via the signed CDN URL and saves to disk; returns the file path. Premium items consume API credits.

## API notes

- Search and item details need only `Client-ID`; downloads also send `Client-Secret`.
- Endpoints: `GET /v3/search`, `GET /v3/items/{uuid}`, `POST /v3/items/{uuid}/api-download`.

## Development

```bash
npm install
npm run build   # esbuild main.ts -> main.js
npm start
```

## License

MIT
