// Runs the shared sdk-scenarios suite (usedock/dock, pinned in SCENARIOS_REF) against the SDK:
// offline against recorded fixtures, and live when DOCK_API_URL, DOCK_API_KEY and DOCK_WORKSPACE_ID are set.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { Dock, DockError } from '../src/index.js'
import { type FakeServer, startFakeServer } from './fake-server.js'

type Args = Record<string, any>
interface HttpOp {
  method: string
  path: string
  status: number
  headers?: Record<string, string>
}
interface Ops {
  http: Record<string, HttpOp>
  composite: Record<string, { via: string }>
}
interface Step {
  id: string
  op: string
  args?: Args
  capture?: Record<string, string>
  expect: { status: number; ok: boolean; code?: string; data?: unknown }
}
interface Scenario {
  name: string
  steps: Step[]
  cleanup?: { op: string; args?: Args }[]
}
interface Exchange {
  request: { method: string; path: string; body?: unknown; headers?: Record<string, string> }
  response: { status: number; body: unknown }
}
interface Fixture {
  variables: Record<string, string>
  exchanges: Exchange[]
}
interface Envelope {
  status: number
  ok: boolean
  code?: string
  data?: any
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scenariosDir = resolve(repoRoot, process.env.DOCK_SCENARIOS_DIR ?? '../dock/sdk-scenarios')
const available = existsSync(join(scenariosDir, 'ops.yaml'))

if (!available && process.env.CI) {
  throw new Error(
    `sdk-scenarios not found at ${scenariosDir}; CI must check out usedock/dock at SCENARIOS_REF`,
  )
}
if (!available) {
  console.warn(
    `[scenarios] skipped: no sdk-scenarios at ${scenariosDir}. Set DOCK_SCENARIOS_DIR to a usedock/dock checkout's sdk-scenarios directory (commit in SCENARIOS_REF).`,
  )
}

// ---- helpers ----

function subsetMatch(want: unknown, got: unknown): boolean {
  if (want === '$any') return got !== null && got !== undefined
  if (Array.isArray(want)) {
    return Array.isArray(got) && got.length === want.length && want.every((w, i) => subsetMatch(w, got[i]))
  }
  if (want && typeof want === 'object') {
    return (
      !!got &&
      typeof got === 'object' &&
      Object.entries(want).every(([k, w]) => subsetMatch(w, (got as Record<string, unknown>)[k]))
    )
  }
  return want === got
}

function substitute(value: unknown, vars: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const whole = /^\$\{(\w+)\}$/.exec(value)
    if (whole) return vars[whole[1] as string]
    return value.replace(/\$\{(\w+)\}/g, (_, n: string) => String(vars[n]))
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, vars))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, vars)]))
  }
  return value
}

const unreferenced = (value: unknown, vars: Record<string, unknown>) =>
  [...JSON.stringify(value ?? {}).matchAll(/\$\{(\w+)\}/g)].some((m) => !((m[1] as string) in vars))

function rest(args: Args, ...omit: string[]): Args {
  return Object.fromEntries(Object.entries(args).filter(([k]) => !omit.includes(k)))
}

/** Maps an op name to the public SDK call. */
async function callOp(dock: Dock, op: string, a: Args): Promise<unknown> {
  const d = dock.docks
  switch (op) {
    case 'docks.create':
      return d.create(a)
    case 'docks.list':
      return d.list(a)
    case 'docks.get':
      return d.get(a.dockId)
    case 'docks.update':
      return d.update(a.dockId, rest(a, 'dockId'))
    case 'docks.exec':
      return d.exec(a.dockId, a.command, rest(a, 'dockId', 'command'))
    case 'docks.stop':
      return d.stop(a.dockId, rest(a, 'dockId'))
    case 'docks.resume':
      return d.resume(a.dockId, rest(a, 'dockId'))
    case 'docks.branch':
      return d.branch(a.dockId, rest(a, 'dockId'))
    case 'docks.delete':
      return d.delete(a.dockId)
    case 'connectors.list':
      return dock.connectors.list(a.workspaceId)
    case 'connectors.connect':
      return dock.connectors.connect(
        a.workspaceId,
        a.kind,
        rest(a, 'workspaceId', 'kind') as { token: string },
      )
    case 'connectors.disconnect':
      return dock.connectors.disconnect(a.workspaceId, a.kind)
    case 'images.list':
      return dock.images.list()
    case 'operations.get':
      return dock.operations.get(a.operationId)
    case 'docks.files.write':
      return d.files.write(a.dockId, a.path, a.content)
    case 'docks.files.read':
      return { content: await d.files.read(a.dockId, a.path) }
    case 'docks.files.list':
      return { entries: await d.files.list(a.dockId, a.path) }
    default:
      throw new Error(`runner has no mapping for op ${op}`)
  }
}

async function run(dock: Dock, ops: Ops, op: string, args: Args): Promise<Envelope> {
  const status = (ops.http[ops.composite[op]?.via ?? op] as HttpOp).status
  try {
    return { status, ok: true, data: await callOp(dock, op, args) }
  } catch (e) {
    if (e instanceof DockError) return { status: e.status, ok: false, code: e.code }
    throw e
  }
}

async function runScenario(dock: Dock, ops: Ops, doc: Scenario, vars: Record<string, unknown>) {
  try {
    for (const step of doc.steps) {
      const res = await run(dock, ops, step.op, substitute(step.args ?? {}, vars) as Args)
      for (const [name, path] of Object.entries(step.capture ?? {})) {
        vars[name] = path.split('.').reduce<any>((o, k) => o?.[k], { data: res.data })
      }
      const want = substitute(step.expect, vars) as Step['expect']
      expect({ status: res.status, ok: res.ok }, `${doc.name}/${step.id}: ${JSON.stringify(res)}`).toEqual({
        status: want.status,
        ok: want.ok,
      })
      if (want.code) expect(res.code, `${doc.name}/${step.id}`).toBe(want.code)
      if (want.data !== undefined) {
        expect(
          subsetMatch(want.data, res.data),
          `${doc.name}/${step.id}: got ${JSON.stringify(res.data)}`,
        ).toBe(true)
      }
    }
  } finally {
    for (const step of doc.cleanup ?? []) {
      if (unreferenced(step, vars)) continue
      await run(dock, ops, step.op, substitute(step.args ?? {}, vars) as Args).catch(() => undefined)
    }
  }
}

// ---- load ----

const ops = (
  available ? parse(readFileSync(join(scenariosDir, 'ops.yaml'), 'utf8')) : { http: {}, composite: {} }
) as Ops
const files = available
  ? readdirSync(join(scenariosDir, 'scenarios'))
      .filter((f) => f.endsWith('.yaml'))
      .sort()
  : []
const scenarios = files.map((file) => ({
  file,
  doc: parse(readFileSync(join(scenariosDir, 'scenarios', file), 'utf8')) as Scenario,
}))
const loadFixture = (name: string) =>
  JSON.parse(readFileSync(join(scenariosDir, 'fixtures', `${name}.json`), 'utf8')) as Fixture

describe.skipIf(!available)('scenario files', () => {
  const schema = JSON.parse(readFileSync(join(scenariosDir, 'schema', 'scenario.schema.json'), 'utf8'))
  const validate = new Ajv({ allErrors: true }).compile(schema)

  it('finds at least one scenario', () => {
    expect(scenarios.length).toBeGreaterThan(0)
  })

  it.each(scenarios)('$file matches the schema and every op has a runner mapping', ({ doc }) => {
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true)
    for (const step of [...doc.steps, ...(doc.cleanup ?? [])]) {
      const known = step.op in ops.http || step.op in ops.composite
      expect(known, `unknown op ${step.op}`).toBe(true)
    }
  })
})

describe.skipIf(!available)('recorded fake', () => {
  let server: FakeServer | undefined
  afterAll(async () => server?.close())

  it.each(scenarios)('$file passes offline against its fixture', async ({ doc }) => {
    const fixture = loadFixture(doc.name)
    const used = new Set<number>()
    const misses: string[] = []
    server = await startFakeServer((req) => {
      const i = fixture.exchanges.findIndex(
        (e, idx) =>
          !used.has(idx) &&
          e.request.method === req.method &&
          e.request.path === req.path &&
          subsetMatch(e.request.body ?? {}, req.body ?? {}) &&
          subsetMatch(
            e.request.headers ?? {},
            Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v])),
          ),
      )
      const hit = fixture.exchanges[i]
      if (!hit) {
        misses.push(`${req.method} ${req.path} ${req.rawBody}`)
        return { status: 404, body: { ok: false, code: 'dock_not_found', message: 'Dock not found' } }
      }
      used.add(i)
      return hit.response
    })
    try {
      const dock = new Dock({ apiKey: 'dock_fixture', baseUrl: server.url })
      await runScenario(dock, ops, doc, { ...fixture.variables })
      // Requests the fake could not match are only acceptable in cleanup (answered 404, ignored).
      const unusedExchanges = fixture.exchanges.map((_, i) => i).filter((i) => !used.has(i))
      expect(unusedExchanges, `unused fixture exchanges (misses: ${misses.join('; ')})`).toEqual([])
    } finally {
      await server.close()
      server = undefined
    }
  })
})

const liveConfigured = !!(
  process.env.DOCK_API_URL &&
  process.env.DOCK_API_KEY &&
  process.env.DOCK_WORKSPACE_ID
)

describe.skipIf(!available || !liveConfigured)('live', () => {
  let dock: Dock
  beforeAll(() => {
    dock = new Dock()
  })

  it.each(scenarios)(
    '$file passes against a real Dock',
    async ({ doc }) => {
      const run = Math.random().toString(36).slice(2, 8)
      await runScenario(dock, ops, doc, { workspaceId: process.env.DOCK_WORKSPACE_ID, run })
    },
    300_000,
  )
})
