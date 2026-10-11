import { afterEach, describe, expect, it } from 'vitest'
import { listCommand, writeCommand } from '../src/files.js'
import { Dock, DockError, ErrorCodes } from '../src/index.js'
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

describe('connectors', () => {
  const WS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const view = { kind: 'linear', type: 'tool', status: 'connected', accountLabel: 'a', scopes: [] }

  it('create sends connectors and the Dock object carries them back', async () => {
    const { dock, server } = await setup(() =>
      ok({ id: ID, name: 'a', state: 'ready', connectors: ['linear'] }, 201),
    )
    const created = await dock.docks.create({ workspaceId: WS, connectors: ['linear', 'slack'] })
    expect(created.connectors).toEqual(['linear'])
    expect(server.requests[0]?.body).toMatchObject({ workspaceId: WS, connectors: ['linear', 'slack'] })
  })

  it('list reads the workspace connectors', async () => {
    const { dock, server } = await setup(() => ok([view]))
    expect(await dock.connectors.list(WS)).toEqual([view])
    expect(server.requests[0]).toMatchObject({ method: 'GET', path: `/v1/workspaces/${WS}/connectors` })
  })

  it('connect PUTs the token and disconnect DELETEs the kind', async () => {
    const { dock, server } = await setup((req) =>
      req.method === 'PUT' ? ok(view) : ok({ kind: 'linear', status: 'not_connected' }),
    )
    expect(await dock.connectors.connect(WS, 'linear', { token: 'tok' })).toMatchObject({
      status: 'connected',
    })
    expect(await dock.connectors.disconnect(WS, 'linear')).toEqual({
      kind: 'linear',
      status: 'not_connected',
    })
    expect(server.requests[0]).toMatchObject({
      method: 'PUT',
      path: `/v1/workspaces/${WS}/connectors/linear`,
      body: { token: 'tok' },
    })
    expect(server.requests[1]).toMatchObject({
      method: 'DELETE',
      path: `/v1/workspaces/${WS}/connectors/linear`,
    })
  })

  it('encodes the kind in the path', async () => {
    const { dock, server } = await setup(() => ok({ kind: 'x', status: 'not_connected' }))
    await dock.connectors.disconnect(WS, 'a/b')
    expect(server.requests[0]?.path).toBe(`/v1/workspaces/${WS}/connectors/a%2Fb`)
  })

  it.each([
    ['connector_not_connected', 409],
    ['connector_admin_only', 403],
    ['connector_not_found', 404],
    ['connector_token_invalid', 400],
    ['connector_unreachable', 502],
    ['image_unknown', 400],
    ['image_unavailable', 400],
    ['port_not_found', 404],
    ['port_limit_reached', 409],
    ['ports_unavailable', 503],
  ] as const)('surfaces %s as a DockError', async (code, status) => {
    const { dock } = await setup(() => ({ status, body: { ok: false, code, message: 'nope' } }))
    const err = await dock.docks.create({ connectors: ['slack'] }).catch((e) => e)
    expect(err).toBeInstanceOf(DockError)
    expect(err).toMatchObject({ code, status })
    expect(Object.values(ErrorCodes)).toContain(code)
  })
})

describe('connectors credentialType', () => {
  it('list carries credentialType, null when not connected', async () => {
    const rows = [
      { kind: 'linear', type: 'tool', status: 'connected', credentialType: 'personal_token' },
      { kind: 'figma', type: 'tool', status: 'not_connected', credentialType: null },
    ]
    const { dock } = await setup(() => ok(rows))
    const list = await dock.connectors.list('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(list.map((c) => c.credentialType)).toEqual(['personal_token', null])
  })
})

describe('environments', () => {
  const ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const env = { id: 'e1', organizationId: ORG, name: 'base', providerKeys: 'gateway' }

  it('list and get read providerKeys', async () => {
    const { dock, server } = await setup((req) => (req.path === '/v1/environments' ? ok([env]) : ok(env)))
    expect((await dock.environments.list(ORG))[0]?.providerKeys).toBe('gateway')
    expect((await dock.environments.get('base', { organizationId: ORG })).providerKeys).toBe('gateway')
    expect(server.requests[0]).toMatchObject({ method: 'GET', path: '/v1/environments' })
    expect(server.requests[1]?.path).toBe('/v1/environments/base')
  })

  it('update PATCHes providerKeys', async () => {
    const { dock, server } = await setup(() => ok({ ...env, providerKeys: 'plain' }))
    const updated = await dock.environments.update('base', { providerKeys: 'plain' }, { organizationId: ORG })
    expect(updated.providerKeys).toBe('plain')
    expect(server.requests[0]).toMatchObject({
      method: 'PATCH',
      path: '/v1/environments/base',
      body: { providerKeys: 'plain' },
    })
  })
})

describe('images', () => {
  it('list reads the Dockyard catalog', async () => {
    const image = {
      name: 'node-22',
      description: 'd',
      arch: ['amd64'],
      sizeMiB: 2048,
      contents: 'c',
      available: false,
    }
    const { dock, server } = await setup(() => ok([image]))
    expect(await dock.images.list()).toEqual([image])
    expect(server.requests[0]).toMatchObject({ method: 'GET', path: '/v1/images' })
  })
})

describe('ports', () => {
  const port = { port: 3000, visibility: 'private', url: 'https://x.example', createdAt: 't', extra: 1 }

  it('list reads the exposed ports', async () => {
    const { dock, server } = await setup(() => ok([port]))
    expect(await dock.docks.ports.list(ID)).toEqual([port])
    expect(server.requests[0]).toMatchObject({ method: 'GET', path: `/v1/docks/${ID}/ports` })
  })

  it('expose sends the port and visibility', async () => {
    const { dock, server } = await setup(() => ok({ ...port, visibility: 'public' }, 201))
    const res = await dock.docks.ports.expose(ID, 3000, { visibility: 'public' })
    expect(res.visibility).toBe('public')
    expect(server.requests[0]).toMatchObject({
      method: 'POST',
      path: `/v1/docks/${ID}/ports`,
      body: { port: 3000, visibility: 'public' },
    })
  })

  it('expose omits visibility when not given', async () => {
    const { dock, server } = await setup(() => ok(port, 201))
    await dock.docks.ports.expose(ID, 3000)
    expect(server.requests[0]?.rawBody).toBe('{"port":3000}')
  })

  it('remove DELETEs the port', async () => {
    const { dock, server } = await setup(() => ok({ deleted: true }))
    expect(await dock.docks.ports.remove(ID, 3000)).toEqual({ deleted: true })
    expect(server.requests[0]).toMatchObject({ method: 'DELETE', path: `/v1/docks/${ID}/ports/3000` })
  })

  it('surfaces port_not_found as a DockError', async () => {
    const { dock } = await setup(() => ({
      status: 404,
      body: { ok: false, code: 'port_not_found', message: 'n' },
    }))
    const err = await dock.docks.ports.remove(ID, 1).catch((e) => e)
    expect(err).toBeInstanceOf(DockError)
    expect(err).toMatchObject({ code: 'port_not_found', status: 404 })
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
  const sentCommand = (server: FakeServer) => (server.requests.at(-1)?.body as { command: string }).command

  it('write sends base64 content and a quoted path in one exec call', async () => {
    const { dock, server } = await setup(() => exec())
    const res = await dock.docks.files.write(ID, "/home/user/it's.txt", "hello 'x' $HOME\n")
    expect(res).toEqual({ path: "/home/user/it's.txt" })
    const command = sentCommand(server)
    expect(command).toBe(
      `d=$(dirname -- '/home/user/it'\\''s.txt'; echo x) && mkdir -p -- "\${d%??}" && printf '%s' '${Buffer.from("hello 'x' $HOME\n").toString('base64')}' | base64 -d > '/home/user/it'\\''s.txt'`,
    )
    expect(command).not.toContain('$HOME')
  })

  it('read decodes base64 stdout as UTF-8', async () => {
    const { dock, server } = await setup(() => exec(Buffer.from('héllo\n').toString('base64')))
    expect(await dock.docks.files.read(ID, '/a b')).toBe('héllo\n')
    expect(sentCommand(server)).toBe("base64 -w0 -- '/a b'")
  })

  it('list decodes one base64 name per line as UTF-8, names may hold newlines', async () => {
    const b64 = (s: string) => Buffer.from(s).toString('base64')
    const stdout = `${b64('.hidden')}\n${b64('multi\nline')}\n\n${b64('é.txt')}\n`
    const { dock, server } = await setup(() => exec(stdout))
    expect(await dock.docks.files.list(ID, '/home/user')).toEqual(['.hidden', 'multi\nline', 'é.txt'])
    expect(sentCommand(server)).toBe(listCommand('/home/user'))
    expect(sentCommand(server)).toContain('find -H "$p"')
  })

  it('file_command_failed: a non-zero exit', async () => {
    const { dock } = await setup(() => ok({ exitCode: 1, stdout: '', stderr: 'No such file\n' }))
    await expect(dock.docks.files.read(ID, '/nope')).rejects.toMatchObject({
      code: 'file_command_failed',
      status: 200,
    })
    await expect(dock.docks.files.write(ID, '/nope', 'x')).rejects.toMatchObject({
      code: 'file_command_failed',
    })
    // list on a path that is not a directory exits non-zero (test -d)
    await expect(dock.docks.files.list(ID, '/nope')).rejects.toMatchObject({ code: 'file_command_failed' })
  })

  it('output_truncated: the exec result is truncated', async () => {
    const { dock } = await setup(() => exec('aGk=', 0, { truncated: true }))
    await expect(dock.docks.files.read(ID, '/big')).rejects.toMatchObject({
      code: 'output_truncated',
      status: 200,
    })
    await expect(dock.docks.files.list(ID, '/big')).rejects.toMatchObject({ code: 'output_truncated' })
  })

  it('file_too_large: oversized content is refused before sending anything', async () => {
    const { dock, server } = await setup(() => exec())
    await dock.docks.files.write(ID, '/ok', 'x'.repeat(40 * 1024))
    expect(server.requests).toHaveLength(1)
    await expect(dock.docks.files.write(ID, '/big', 'x'.repeat(49 * 1024))).rejects.toMatchObject({
      code: 'file_too_large',
      status: 0,
    })
    expect(server.requests).toHaveLength(1)
  })

  it('file_too_large: a huge path fails read and list before sending', async () => {
    const { dock, server } = await setup(() => exec())
    const path = `/${'a'.repeat(64 * 1024)}`
    await expect(dock.docks.files.read(ID, path)).rejects.toMatchObject({ code: 'file_too_large' })
    await expect(dock.docks.files.list(ID, path)).rejects.toMatchObject({ code: 'file_too_large' })
    expect(server.requests).toHaveLength(0)
  })

  it('counts the command limit in UTF-8 bytes, as the API does', async () => {
    const { dock, server } = await setup(() => exec())
    // 80 three-byte characters: the command is under 64K UTF-16 units but over 64 KB of UTF-8.
    const path = `/home/user/work/${'文'.repeat(80)}.txt`
    const content = 'x'.repeat(48_900)
    const command = writeCommand(path, content)
    expect(command.length).toBeLessThanOrEqual(64 * 1024)
    expect(Buffer.byteLength(command)).toBeGreaterThan(64 * 1024)
    await expect(dock.docks.files.write(ID, path, content)).rejects.toMatchObject({
      code: 'file_too_large',
      status: 0,
    })
    expect(server.requests).toHaveLength(0)
  })

  it('rejects empty and NUL paths', async () => {
    const { dock } = await setup(() => exec())
    await expect(dock.docks.files.read(ID, '')).rejects.toMatchObject({ code: 'validation_error' })
    await expect(dock.docks.files.list(ID, 'a\0b')).rejects.toMatchObject({ code: 'validation_error' })
  })
})
