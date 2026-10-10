import { type IncomingMessage, type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface RecordedRequest {
  method: string
  url: string
  path: string
  headers: IncomingMessage['headers']
  body: unknown
  rawBody: string
}

export interface FakeResponse {
  status: number
  body?: unknown
  /** Raw text sent instead of JSON `body`. */
  text?: string
}

export type Handler = (req: RecordedRequest) => FakeResponse

export interface FakeServer {
  url: string
  requests: RecordedRequest[]
  close(): Promise<void>
}

/** A tiny local HTTP server; the handler decides every response. */
export async function startFakeServer(handler: Handler): Promise<FakeServer> {
  const requests: RecordedRequest[] = []
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8')
      let body: unknown
      try {
        body = rawBody ? JSON.parse(rawBody) : undefined
      } catch {
        body = undefined
      }
      const url = req.url ?? '/'
      const recorded: RecordedRequest = {
        method: req.method ?? 'GET',
        url,
        path: url.split('?')[0] ?? url,
        headers: req.headers,
        body,
        rawBody,
      }
      requests.push(recorded)
      const out = handler(recorded)
      res.statusCode = out.status
      if (out.text !== undefined) {
        res.end(out.text)
      } else {
        res.setHeader('content-type', 'application/json')
        res.end(out.body === undefined ? '' : JSON.stringify(out.body))
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
