import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { Dock, DockError } from '../src/index.js'
import { type FakeServer, type Handler, startFakeServer } from './fake-server.js'

const ID = '11111111-1111-4111-8111-111111111111'
const ok = (data: unknown, status = 200) => ({ status, body: { ok: true, data } })
const exec = (stdout = '', exitCode = 0, extra: Record<string, unknown> = {}) =>
  ok({ exitCode, stdout, stderr: '', durationMs: 1, truncated: false, ...extra })

let server: FakeServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

async function setup(handler: Handler) {
  server = await startFakeServer(handler)
  return { dock: new Dock({ apiKey: 'dock_test', baseUrl: server.url }), server }
}

describe('construction', () => {
  it('reads DOCK_API_KEY and DOCK_API_URL from the environment', async () => {
    const s = await startFakeServer(() => ok([]))
    server = s
    const prev = { key: process.env.DOCK_API_KEY, url: process.env.DOCK_API_URL }
    process.env.DOCK_API_KEY = 'dock_env'
    process.env.DOCK_API_URL = `${s.url}/`
    try {
      await new Dock().docks.list()
    } finally {
      for (const [k, v] of [
        ['DOCK_API_KEY', prev.key],
        ['DOCK_API_URL', prev.url],
      ] as const) {
        if (v === undefined) Reflect.deleteProperty(process.env, k)
        else process.env[k] = v
      }
    }
    expect(s.requests[0]?.headers.authorization).toBe('Bearer dock_env')
    expect(s.requests[0]?.path).toBe('/v1/docks')
  })

  it('throws a DockError without an API key', () => {
    const prev = process.env.DOCK_API_KEY
    Reflect.deleteProperty(process.env, 'DOCK_API_KEY')
    try {
      expect(() => new Dock()).toThrowError(expect.objectContaining({ code: 'missing_api_key' }))
    } finally {
      if (prev !== undefined) process.env.DOCK_API_KEY = prev
    }
  })

  it('defaults the base URL to the hosted API', async () => {
    let seen = ''
    const dock = new Dock({
      apiKey: 'dock_x',
      fetch: (async (url: URL) => {
        seen = String(url)
        return new Response(JSON.stringify({ ok: true, data: [] }))
      }) as unknown as typeof fetch,
    })
    await dock.docks.list()
    expect(seen).toBe('https://api.usedock.io/v1/docks')
  })
})

describe('docks', () => {
  it('create posts the body, omits undefined fields and sends the bearer key', async () => {
    const { dock, server } = await setup(() => ok({ id: ID, name: 'a', state: 'ready', extra: 1 }, 201))
    const created = await dock.docks.create({ name: 'a', cpus: 2, image: undefined, env: { A: '1' } })
    expect(created).toMatchObject({ id: ID, state: 'ready', extra: 1 })
    const req = server.requests[0]
    expect(req).toMatchObject({
      method: 'POST',
      path: '/v1/docks',
      body: { name: 'a', cpus: 2, env: { A: '1' } },
    })
    expect(req?.rawBody).not.toContain('image')
    expect(req?.headers.authorization).toBe('Bearer dock_test')
    expect(req?.headers['idempotency-key']).toBeUndefined()
  })

  it('create and branch forward the idempotency key', async () => {
    const { dock, server } = await setup(() => ok({ id: ID, name: 'a', state: 'ready' }, 201))
    await dock.docks.create({}, { idempotencyKey: 'k1' })
    await dock.docks.branch(ID, {}, { idempotencyKey: 'k2' })
    expect(server.requests.map((r) => r.headers['idempotency-key'])).toEqual(['k1', 'k2'])
  })

  it('list sends filter and all as query parameters', async () => {
    const { dock, server } = await setup(() => ok([{ id: ID, name: 'a', state: 'ready' }]))
    const rows = await dock.docks.list({ filter: 'sdk-', all: true })
    expect(rows).toHaveLength(1)
    expect(server.requests[0]?.url).toBe('/v1/docks?filter=sdk-&all=true')
    await dock.docks.list()
    expect(server.requests[1]?.url).toBe('/v1/docks')
  })

  it('get and update use the dock path', async () => {
    const { dock, server } = await setup(() => ok({ id: ID, name: 'b', state: 'ready' }))
    await dock.docks.get(ID)
    await dock.docks.update(ID, { name: 'b', ttlSeconds: 60 })
    await dock.docks.update(ID, { ttlSeconds: null })
    expect(server.requests[0]).toMatchObject({ method: 'GET', path: `/v1/docks/${ID}` })
    expect(server.requests[1]).toMatchObject({
      method: 'PATCH',
      path: `/v1/docks/${ID}`,
      body: { name: 'b', ttlSeconds: 60 },
    })
    // null clears the TTL (disables auto-stop) and must be sent, not dropped like undefined.
    expect(server.requests[2]?.rawBody).toBe('{"ttlSeconds":null}')
  })

  it('exec sends the command and options and returns the result', async () => {
    const { dock, server } = await setup(() => exec('hi\n'))
    const res = await dock.docks.exec(ID, 'echo hi', {
      cwd: '/home/user',
      timeoutSeconds: 5,
      env: { X: '1' },
    })
    expect(res.stdout).toBe('hi\n')
    expect(res.exitCode).toBe(0)
    expect(server.requests[0]).toMatchObject({
      method: 'POST',
      path: `/v1/docks/${ID}/exec`,
      body: { command: 'echo hi', cwd: '/home/user', timeoutSeconds: 5, env: { X: '1' } },
    })
  })

  it('stop, resume and branch post to their routes', async () => {
    // The API answers stop and resume with only { id, state }; branch returns the new dock.
    const { dock, server } = await setup((req) =>
      req.path.endsWith('/branch')
        ? ok({ id: ID, name: 'copy', state: 'ready' }, 201)
        : ok({ id: ID, state: req.path.endsWith('/stop') ? 'archived' : 'ready' }, 202),
    )
    expect(await dock.docks.stop(ID, { force: true })).toEqual({ id: ID, state: 'archived' })
    expect(await dock.docks.resume(ID, { cpus: 2 })).toEqual({ id: ID, state: 'ready' })
    await dock.docks.branch(ID, { name: 'copy' })
    expect(server.requests.map((r) => [r.method, r.path, r.body])).toEqual([
      ['POST', `/v1/docks/${ID}/stop`, { force: true }],
      ['POST', `/v1/docks/${ID}/resume`, { cpus: 2 }],
      ['POST', `/v1/docks/${ID}/branch`, { name: 'copy' }],
    ])
  })

  it('delete sends the confirm header and returns { operation } that operations.get can poll', async () => {
    // Shape of DocksService.remove: { operation: OperationView }.
    const { dock, server } = await setup((req) =>
      req.method === 'DELETE'
        ? ok({ operation: { id: 'op-1', targetType: 'dock', targetId: ID, status: 'completed' } }, 202)
        : ok({ id: 'op-1', targetType: 'dock', targetId: ID, status: 'completed' }),
    )
    const { operation } = await dock.docks.delete(ID)
    expect(operation).toEqual({ id: 'op-1', targetType: 'dock', targetId: ID, status: 'completed' })
    await dock.operations.get(operation.id)
    expect(server.requests[1]).toMatchObject({ method: 'GET', path: '/v1/operations/op-1' })
    expect(server.requests[0]).toMatchObject({ method: 'DELETE', path: `/v1/docks/${ID}` })
    expect(server.requests[0]?.headers['x-confirm-delete']).toBe(ID)
  })

  it('operations.get fetches an operation', async () => {
    const { dock, server } = await setup(() => ok({ id: 'op-1', status: 'completed' }))
    expect((await dock.operations.get('op-1')).status).toBe('completed')
    expect(server.requests[0]).toMatchObject({ method: 'GET', path: '/v1/operations/op-1' })
  })

  it('tolerates dock responses with only id, name and state', async () => {
    const { dock } = await setup(() => ok({ id: ID, name: 'a', state: 'ready' }))
    expect(await dock.docks.get(ID)).toEqual({ id: ID, name: 'a', state: 'ready' })
  })
})

describe('errors', () => {
  it('maps the error envelope to a DockError with code, status and message', async () => {
    const { dock } = await setup(() => ({
      status: 404,
      body: { ok: false, code: 'dock_not_found', message: 'Dock not found' },
    }))
    const err = await dock.docks.get(ID).catch((e) => e)
    expect(err).toBeInstanceOf(DockError)
    expect(err).toMatchObject({
      code: 'dock_not_found',
      status: 404,
      message: 'Dock not found',
      name: 'DockError',
    })
  })

  it('falls back to http_<status> for non-envelope failures', async () => {
    const { dock } = await setup(() => ({ status: 502, text: '<html>bad gateway</html>' }))
    await expect(dock.docks.list()).rejects.toMatchObject({ code: 'http_502', status: 502 })
  })

  it('rejects a 200 that is not an envelope', async () => {
    const { dock } = await setup(() => ({ status: 200, text: 'hello' }))
    await expect(dock.docks.list()).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('wraps transport failures with status 0', async () => {
    const s = await startFakeServer(() => ok([]))
    const url = s.url
    await s.close()
    const dock = new Dock({ apiKey: 'dock_x', baseUrl: url })
    await expect(dock.docks.list()).rejects.toMatchObject({ code: 'network_error', status: 0 })
  })
})

describe('files', () => {
  it('write sends base64 content and a quoted path in one exec call', async () => {
    const { dock, server } = await setup(() => exec())
    const res = await dock.docks.files.write(ID, "/home/user/it's.txt", "hello 'x' $HOME\n")
    expect(res).toEqual({ path: "/home/user/it's.txt" })
    const command = (server.requests[0]?.body as { command: string }).command
    expect(command).toBe(
      `mkdir -p -- "$(dirname -- '/home/user/it'\\''s.txt')" && printf '%s' '${Buffer.from("hello 'x' $HOME\n").toString('base64')}' | base64 -d > '/home/user/it'\\''s.txt'`,
    )
    expect(command).not.toContain('$HOME')
  })

  it('read decodes base64 stdout as UTF-8', async () => {
    const { dock, server } = await setup(() => exec(Buffer.from('héllo\n').toString('base64')))
    expect(await dock.docks.files.read(ID, '/a b')).toBe('héllo\n')
    expect((server.requests[0]?.body as { command: string }).command).toBe("base64 -w0 -- '/a b'")
  })

  it('list splits stdout on newlines and drops empty lines', async () => {
    const { dock, server } = await setup(() => exec('.hidden\na.txt\n\nb.txt\n'))
    expect(await dock.docks.files.list(ID, '/home/user')).toEqual(['.hidden', 'a.txt', 'b.txt'])
    expect((server.requests[0]?.body as { command: string }).command).toBe("ls -1A -- '/home/user'")
  })

  it('treats a non-zero exit as an error', async () => {
    const { dock } = await setup(() => ok({ exitCode: 1, stdout: '', stderr: 'No such file\n' }))
    await expect(dock.docks.files.read(ID, '/nope')).rejects.toMatchObject({ code: 'file_error' })
  })

  it('treats truncated output as an error', async () => {
    const { dock } = await setup(() => exec('aGk=', 0, { truncated: true }))
    await expect(dock.docks.files.read(ID, '/big')).rejects.toMatchObject({ code: 'file_error' })
  })

  it('refuses oversized content before sending anything', async () => {
    const { dock, server } = await setup(() => exec())
    await dock.docks.files.write(ID, '/ok', 'x'.repeat(40 * 1024))
    expect(server.requests).toHaveLength(1)
    await expect(dock.docks.files.write(ID, '/big', 'x'.repeat(49 * 1024))).rejects.toMatchObject({
      code: 'validation_error',
      status: 0,
    })
    expect(server.requests).toHaveLength(1)
  })

  it('counts the command limit in UTF-8 bytes, as the API does', async () => {
    const { dock, server } = await setup(() => exec())
    // 80 three-byte characters: the command is under 64K UTF-16 units but over 64 KB of UTF-8.
    const path = `/home/user/work/${'文'.repeat(80)}.txt`
    const content = 'x'.repeat(48_900)
    const units = `mkdir -p -- "$(dirname -- '${path}')" && printf '%s' '${Buffer.from(content).toString('base64')}' | base64 -d > '${path}'`
    expect(units.length).toBeLessThanOrEqual(64 * 1024)
    expect(Buffer.byteLength(units)).toBeGreaterThan(64 * 1024)
    await expect(dock.docks.files.write(ID, path, content)).rejects.toMatchObject({
      code: 'validation_error',
      status: 0,
    })
    expect(server.requests).toHaveLength(0)
  })

  it('rejects empty and NUL paths', async () => {
    const { dock } = await setup(() => exec())
    await expect(dock.docks.files.read(ID, '')).rejects.toMatchObject({ code: 'validation_error' })
    await expect(dock.docks.files.list(ID, 'a\0b')).rejects.toMatchObject({ code: 'validation_error' })
  })

  const bash = spawnSync('bash', ['-c', 'base64 -w0 </dev/null'])
  it.skipIf(bash.status !== 0)('hostile paths never run as commands', async () => {
    const { mkdtempSync, existsSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const cwd = mkdtempSync(join(tmpdir(), 'sdk-files-'))
    try {
      const { dock, server } = await setup(() => exec())
      for (const name of ["x'; touch pwned; echo '", 'a $(touch pwned) b', '-n.txt']) {
        await dock.docks.files.write(ID, name, 'data')
        const command = (server.requests.at(-1)?.body as { command: string }).command
        const run = spawnSync('bash', ['-c', command], { cwd, encoding: 'utf8' })
        expect(run.status, run.stderr).toBe(0)
      }
      expect(existsSync(join(cwd, 'pwned'))).toBe(false)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
