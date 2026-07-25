#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const CLIENT_ID = process.env.ICONSCOUT_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ICONSCOUT_CLIENT_SECRET ?? ''
const API = 'https://api.iconscout.com/v3'

if (!CLIENT_ID) {
  console.error('ICONSCOUT_CLIENT_ID is not set. Get credentials at https://iconscout.com/api and set env vars.')
}
const DEFAULT_DOWNLOAD_DIR = process.env.ICONSCOUT_DOWNLOAD_DIR ?? path.join(process.cwd(), 'iconscout-downloads')

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

interface ApiOptions {
  method?: string
  body?: unknown
  secret?: boolean
}

async function api(pathname: string, { method = 'GET', body, secret = false }: ApiOptions = {}): Promise<any> {
  const headers: Record<string, string> = { 'Client-ID': CLIENT_ID, Accept: 'application/json' }
  if (secret) headers['Client-Secret'] = CLIENT_SECRET
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const json = (await res.json().catch(() => null)) as any
  if (!res.ok || json?.status !== 'success') {
    const detail = JSON.stringify(json?.response ?? json?.message ?? json)?.slice(0, 300)
    throw new Error(`Iconscout API ${res.status}: ${detail}`)
  }
  return json.response
}

interface Item {
  id: number
  uuid: string
  asset: string
  name: string
  slug: string
  price: number
  urls?: Record<string, string>
}

function previewUrl(item: Item): string {
  const urls = item.urls ?? {}
  return urls.png_128 ?? urls.png_256 ?? urls.png_64 ?? urls.thumb ?? Object.values(urls)[0] ?? ''
}

function itemLines(item: Item, index?: number): string[] {
  const head = index !== undefined ? `${index + 1}. ${item.name}` : `# ${item.name}`
  const lines = [head, `   uuid: ${item.uuid}`, `   type: ${item.asset} | ${item.price === 0 ? 'free' : 'premium'}`]
  const preview = previewUrl(item)
  if (preview) lines.push(`   preview: ${preview}`)
  return lines
}

function safeFileName(name: string, format: string): string {
  return `${name.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'asset'}.${format}`
}

// ---------------------------------------------------------------------------
// MCP server + tools
// ---------------------------------------------------------------------------

const server = new McpServer({ name: 'iconscout-mcp', version: '1.0.0' })

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] }
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true }
}

server.registerTool(
  'search_assets',
  {
    description:
      'Search Iconscout for icons, illustrations, 3D assets or Lottie animations. Returns name, uuid (needed for ' +
      'download/preview), price and a preview URL per result.',
    inputSchema: {
      query: z.string().describe('Search query, e.g. "shopping cart"'),
      asset: z
        .enum(['icon', 'illustration', '3d', 'lottie', 'all'])
        .default('icon')
        .describe('Asset type to search'),
      price: z.enum(['all', 'free', 'premium']).default('all').describe('Filter by price'),
      sort: z.enum(['relevant', 'latest', 'popular', 'color']).default('relevant').describe('Sort order'),
      page: z.number().int().min(1).default(1).describe('Result page'),
      limit: z.number().int().min(1).max(50).default(10).describe('Results per page'),
      styles: z.string().optional().describe('Comma-separated style filter, e.g. "line,flat"'),
    },
  },
  async ({ query, asset, price, sort, page, limit, styles }) => {
    try {
      const params = new URLSearchParams({ query, sort, page: String(page), per_page: String(limit) })
      if (asset !== 'all') params.set('asset', asset)
      if (price !== 'all') params.set('price', price)
      if (styles) params.set('styles', styles)
      const response = await api(`/search?${params}`)
      const items = response.items
      const data: Item[] = items.data ?? []
      const lines: string[] = [
        `# Iconscout search: ${query} (${asset}, page ${items.current_page}/${items.last_page}, ${items.total} total)`,
        '',
      ]
      data.forEach((item, i) => lines.push(...itemLines(item, i), ''))
      if (!data.length) lines.push('No results.')
      else lines.push('Use download_asset with a uuid to get the file, or preview_asset to see it.')
      return textResult(lines.join('\n'))
    } catch (error) {
      return errorResult(error)
    }
  },
)

server.registerTool(
  'get_asset',
  {
    description: 'Get details of a single Iconscout item by uuid.',
    inputSchema: { uuid: z.string().describe('Item uuid from search_assets') },
  },
  async ({ uuid }) => {
    try {
      const response = await api(`/items/${uuid}`)
      const item: Item = response.item
      const lines = itemLines(item)
      lines.push(`   slug: ${item.slug}`, `   page: https://iconscout.com/${item.asset === 'icon' ? 'icons' : item.asset}/${item.slug}`)
      return textResult(lines.join('\n'))
    } catch (error) {
      return errorResult(error)
    }
  },
)

server.registerTool(
  'preview_asset',
  {
    description: 'Fetch the PNG preview of an Iconscout item and return it as an image the agent can see.',
    inputSchema: { uuid: z.string().describe('Item uuid from search_assets') },
  },
  async ({ uuid }) => {
    try {
      const response = await api(`/items/${uuid}`)
      const item: Item = response.item
      const url = previewUrl(item)
      if (!url) return errorResult(`No preview URL available for ${item.name} (${item.asset})`)
      if (url.endsWith('.mp4')) {
        return textResult(`Preview for "${item.name}" is a video (lottie): ${url}\nDownload it with download_asset instead.`)
      }
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Preview fetch failed: HTTP ${res.status}`)
      const data = Buffer.from(await res.arrayBuffer()).toString('base64')
      return {
        content: [
          { type: 'text' as const, text: `${item.name} (${item.uuid}, ${item.price === 0 ? 'free' : 'premium'})` },
          { type: 'image' as const, data, mimeType: 'image/png' },
        ],
      }
    } catch (error) {
      return errorResult(error)
    }
  },
)

server.registerTool(
  'download_asset',
  {
    description:
      'Download an Iconscout item in the given format and save it to disk. Returns the saved file path and the ' +
      'signed CDN URL. Premium items consume API credits.',
    inputSchema: {
      uuid: z.string().describe('Item uuid from search_assets'),
      format: z
        .string()
        .default('svg')
        .describe('File format: svg, png, pdf, eps, ai (icons/illustrations); json, gif, mp4 (lottie); fbx, glb, obj (3d)'),
      saveDir: z.string().optional().describe(`Directory to save into (default: ${DEFAULT_DOWNLOAD_DIR})`),
      fileName: z.string().optional().describe('File name override (extension added automatically)'),
    },
  },
  async ({ uuid, format, saveDir, fileName }) => {
    try {
      const response = await api(`/items/${uuid}/api-download`, {
        method: 'POST',
        body: { format },
        secret: true,
      })
      const download = response.download
      const url: string = download.url
      const res = await fetch(url)
      if (!res.ok) throw new Error(`CDN fetch failed: HTTP ${res.status}`)
      const bytes = Buffer.from(await res.arrayBuffer())

      const dir = saveDir ?? DEFAULT_DOWNLOAD_DIR
      await mkdir(dir, { recursive: true })
      const file = path.join(dir, safeFileName(fileName ?? download.name ?? uuid, format))
      await writeFile(file, bytes)

      return textResult(
        [
          `Downloaded: ${download.name ?? uuid}`,
          `file: ${file}`,
          `size: ${(bytes.length / 1024).toFixed(1)} KB`,
          `format: ${format}`,
          `cdn url (expires): ${url}`,
        ].join('\n'),
      )
    } catch (error) {
      return errorResult(error)
    }
  },
)

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

process.stdin.on('end', () => process.exit(0))

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('iconscout-mcp running on stdio')
