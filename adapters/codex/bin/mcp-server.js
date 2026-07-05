#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import { join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

import { runCouncil } from "../lib/codex-runner.js"

const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const serverInfo = { name: "open-magi", version: "0.1.5" }
const headerDelimiter = Buffer.from("\r\n\r\n")
let transportMode = "line"

const tools = [
  {
    name: "run_council",
    description: "Run the three configured Open Magi Codex deliberators and write report-*.md files with provenance.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: {
          type: "string",
          description: "Project root containing .open_magi/magi-log.",
        },
        promptPath: {
          type: "string",
          description: "Path to round-NNN/council-PPP/prompt.md.",
        },
        round: {
          type: "integer",
          minimum: 1,
          description: "Current Magi round number.",
        },
        pass: {
          type: "integer",
          minimum: 1,
          description: "Current council pass number.",
        },
        timeoutMs: {
          type: "integer",
          minimum: 1000,
          description: "Per-deliberator timeout in milliseconds.",
        },
      },
      required: ["projectRoot", "promptPath", "round", "pass"],
      additionalProperties: false,
    },
  },
]

function send(payload) {
  const json = JSON.stringify(payload)
  if (transportMode === "header") {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`)
  } else {
    process.stdout.write(`${json}\n`)
  }
}

function result(id, payload) {
  send({ jsonrpc: "2.0", id, result: payload })
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } })
}

function isSafeRelativePath(path) {
  const normalized = normalize(path)
  return normalized && !normalized.startsWith("..") && !normalized.startsWith("/") && !normalized.includes("\0")
}

async function readSkillResource(uri) {
  const prefix = "skill://magi/"
  if (!uri.startsWith(prefix)) throw new Error(`unsupported resource uri: ${uri}`)
  const relativePath = uri.slice(prefix.length) || "SKILL.md"
  if (!isSafeRelativePath(relativePath)) throw new Error(`unsafe resource uri: ${uri}`)
  const text = await readFile(join(packageRoot, "skills", "magi", relativePath), "utf8")
  return {
    contents: [
      {
        uri,
        mimeType: "text/markdown",
        text,
      },
    ],
  }
}

async function handleRequest(message) {
  const { id, method, params } = message
  if (!id && method?.startsWith("notifications/")) return

  try {
    if (method === "initialize") {
      result(id, {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: {
          resources: { listChanged: false },
          tools: { listChanged: false },
        },
        serverInfo,
      })
      return
    }
    if (method === "tools/list") {
      result(id, { tools })
      return
    }
    if (method === "tools/call") {
      if (params?.name !== "run_council") throw new Error(`unknown tool: ${params?.name}`)
      const output = await runCouncil(params.arguments || {})
      result(id, {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        isError: !output.ok,
      })
      return
    }
    if (method === "resources/list") {
      result(id, {
        resources: [
          {
            uri: "skill://magi/SKILL.md",
            name: "Magi SKILL.md",
            mimeType: "text/markdown",
          },
        ],
      })
      return
    }
    if (method === "resources/templates/list") {
      result(id, { resourceTemplates: [] })
      return
    }
    if (method === "resources/read") {
      result(id, await readSkillResource(params?.uri || ""))
      return
    }
    error(id, -32601, `method not found: ${method}`)
  } catch (err) {
    error(id, -32000, err?.message || String(err))
  }
}

let buffer = Buffer.alloc(0)
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
  while (true) {
    let line = ""
    const headerIndex = buffer.indexOf(headerDelimiter)
    if (headerIndex !== -1) {
      const header = buffer.slice(0, headerIndex).toString("utf8")
      const match = header.match(/(?:^|\r\n)Content-Length:\s*(\d+)/i)
      if (match) {
        transportMode = "header"
        const contentLength = Number(match[1])
        const bodyStart = headerIndex + headerDelimiter.length
        const bodyEnd = bodyStart + contentLength
        if (buffer.length < bodyEnd) break
        line = buffer.slice(bodyStart, bodyEnd).toString("utf8").trim()
        buffer = buffer.slice(bodyEnd)
      }
    }
    if (!line) {
      const index = buffer.indexOf(0x0a)
      if (index === -1) break
      line = buffer.slice(0, index).toString("utf8").trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
    }
    try {
      void handleRequest(JSON.parse(line))
    } catch (err) {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: err?.message || String(err) } })
    }
  }
})
