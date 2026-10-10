import { DockError } from './errors.js'
import { assertPath, fromBase64, listCommand, readCommand, writeCommand } from './files.js'
import type {
  BranchParams,
  CreateDockParams,
  DeleteDockResult,
  DockInfo,
  DockStateResult,
  ExecOptions,
  ExecResult,
  IdempotencyOptions,
  ListDocksParams,
  Operation,
  ResumeParams,
  StopOptions,
  UpdateDockParams,
  WriteFileResult,
} from './types.js'

export const DEFAULT_BASE_URL = 'https://api.usedock.io'

export interface DockOptions {
  /** API key (`dock_...`). Defaults to the `DOCK_API_KEY` environment variable. */
  apiKey?: string
  /** Control-plane origin without `/v1`. Defaults to `DOCK_API_URL`, then `https://api.usedock.io`. */
  baseUrl?: string
  /** Custom fetch, for tests or proxies. Defaults to the global `fetch`. */
  fetch?: typeof fetch
}

interface RequestOptions {
  method: string
  path: string
  body?: Record<string, unknown>
  query?: Record<string, string | boolean | undefined>
  headers?: Record<string, string>
}

type Send = <T>(o: RequestOptions) => Promise<T>

const env = (name: string): string | undefined =>
  typeof process !== 'undefined' ? process.env?.[name] || undefined : undefined

/** Drops undefined values so absent options are omitted from the JSON body, never sent as null. */
function compact(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined))
}

export class Dock {
  readonly docks: DocksApi
  readonly operations: OperationsApi
  readonly #apiKey: string
  readonly #baseUrl: string
  readonly #fetch: typeof fetch

  constructor(options: DockOptions = {}) {
    const apiKey = options.apiKey ?? env('DOCK_API_KEY')
    if (!apiKey) {
      throw new DockError('missing_api_key', 'No API key: pass { apiKey } or set DOCK_API_KEY', 0)
    }
    this.#apiKey = apiKey
    this.#baseUrl = (options.baseUrl ?? env('DOCK_API_URL') ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    const f = options.fetch ?? globalThis.fetch
    if (!f) throw new DockError('missing_fetch', 'No global fetch; use Node 18+ or pass { fetch }', 0)
    this.#fetch = f.bind(globalThis)
    const send: Send = (o) => this.#request(o)
    this.docks = new DocksApi(send)
    this.operations = new OperationsApi(send)
  }

  async #request<T>(o: RequestOptions): Promise<T> {
    const url = new URL(`${this.#baseUrl}${o.path}`)
    for (const [k, v] of Object.entries(o.query ?? {}))
      if (v !== undefined) url.searchParams.set(k, String(v))
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#apiKey}`,
      accept: 'application/json',
      ...o.headers,
    }
    let body: string | undefined
    if (o.body !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(o.body)
    }
    let res: Response
    try {
      res = await this.#fetch(url, { method: o.method, headers, body })
    } catch (cause) {
      throw new DockError('network_error', `Request failed: ${(cause as Error)?.message ?? cause}`, 0, {
        cause,
      })
    }
    const text = await res.text()
    let envelope: { ok?: boolean; data?: unknown; code?: unknown; message?: unknown } | undefined
    try {
      envelope = text ? JSON.parse(text) : undefined
    } catch {
      envelope = undefined
    }
    if (!res.ok || envelope?.ok === false) {
      const code = typeof envelope?.code === 'string' ? envelope.code : `http_${res.status}`
      const message =
        typeof envelope?.message === 'string' ? envelope.message : res.statusText || `HTTP ${res.status}`
      throw new DockError(code, message, res.status)
    }
    if (envelope?.ok !== true) {
      throw new DockError('invalid_response', 'Response is not a Dock API envelope', res.status)
    }
    return envelope.data as T
  }
}

const dockPath = (id: string, suffix = '') => `/v1/docks/${encodeURIComponent(id)}${suffix}`

function idempotencyHeader(options: IdempotencyOptions): Record<string, string> | undefined {
  return options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : undefined
}

export class FilesApi {
  constructor(private readonly docks: DocksApi) {}

  /** Writes UTF-8 text, creating parent directories. One exec call; content is sent as base64. */
  async write(id: string, path: string, content: string): Promise<WriteFileResult> {
    assertPath(path)
    await this.#run(id, path, writeCommand(path, content), 'write')
    return { path }
  }

  /** Reads a file as UTF-8 text. */
  async read(id: string, path: string): Promise<string> {
    assertPath(path)
    return fromBase64(await this.#run(id, path, readCommand(path), 'read'))
  }

  /** Lists entry names in a directory (`ls -1A` order), including dotfiles. */
  async list(id: string, path: string): Promise<string[]> {
    assertPath(path)
    const out = await this.#run(id, path, listCommand(path), 'list')
    return out.split('\n').filter(Boolean)
  }

  async #run(id: string, path: string, command: string, verb: string): Promise<string> {
    const res = await this.docks.exec(id, command)
    if (res.exitCode !== 0) {
      throw new DockError(
        'file_error',
        `Could not ${verb} ${path}: exit ${res.exitCode}${res.stderr ? `: ${res.stderr.trim()}` : ''}`,
        200,
      )
    }
    if (res.truncated) {
      throw new DockError('file_error', `Could not ${verb} ${path}: output was truncated`, 200)
    }
    return res.stdout
  }
}

export class DocksApi {
  readonly files: FilesApi

  constructor(private readonly send: Send) {
    this.files = new FilesApi(this)
  }

  create(params: CreateDockParams = {}, options: IdempotencyOptions = {}): Promise<DockInfo> {
    return this.send({
      method: 'POST',
      path: '/v1/docks',
      body: compact(params),
      headers: idempotencyHeader(options),
    })
  }

  list(params: ListDocksParams = {}): Promise<DockInfo[]> {
    return this.send({ method: 'GET', path: '/v1/docks', query: { filter: params.filter, all: params.all } })
  }

  get(id: string): Promise<DockInfo> {
    return this.send({ method: 'GET', path: dockPath(id) })
  }

  update(id: string, params: UpdateDockParams): Promise<DockInfo> {
    return this.send({ method: 'PATCH', path: dockPath(id), body: compact(params) })
  }

  exec(id: string, command: string, options: ExecOptions = {}): Promise<ExecResult> {
    return this.send({ method: 'POST', path: dockPath(id, '/exec'), body: compact({ ...options, command }) })
  }

  /** Returns `{ id, state }` when the Dock has stopped. */
  stop(id: string, options: StopOptions = {}): Promise<DockStateResult> {
    return this.send({ method: 'POST', path: dockPath(id, '/stop'), body: compact(options) })
  }

  /** Returns `{ id, state }` when the Dock is running again. */
  resume(id: string, params: ResumeParams = {}): Promise<DockStateResult> {
    return this.send({ method: 'POST', path: dockPath(id, '/resume'), body: compact(params) })
  }

  /** Copies the Dock into a new one and returns the new Dock. */
  branch(id: string, params: BranchParams = {}, options: IdempotencyOptions = {}): Promise<DockInfo> {
    return this.send({
      method: 'POST',
      path: dockPath(id, '/branch'),
      body: compact(params),
      headers: idempotencyHeader(options),
    })
  }

  /** Deletes the Dock. Sends the required `x-confirm-delete` header; returns `{ operation }` to poll with `operations.get(operation.id)`. */
  delete(id: string): Promise<DeleteDockResult> {
    return this.send({ method: 'DELETE', path: dockPath(id), headers: { 'x-confirm-delete': id } })
  }
}

export class OperationsApi {
  constructor(private readonly send: Send) {}

  get(id: string): Promise<Operation> {
    return this.send({ method: 'GET', path: `/v1/operations/${encodeURIComponent(id)}` })
  }
}
