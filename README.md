# Dock TypeScript SDK

The TypeScript client for [Dock](https://github.com/usedock/dock): isolated Linux machines for agents, on your laptop, your servers, or our cloud.

> **Status:** not published to npm yet; the package name is not claimed. Build it from this repository for now.

Zero runtime dependencies. Uses the global `fetch` (Node 18+, Bun).

## Install

Not published yet. When it is:

```sh
npm install @usedock/sdk
```

## Example

```ts
import { Dock, DockError } from '@usedock/sdk'

const dock = new Dock() // reads DOCK_API_KEY and DOCK_API_URL

const box = await dock.docks.create({ workspaceId: '...', name: 'demo', cpus: 2, memoryMiB: 4096 })

const res = await dock.docks.exec(box.id, 'echo hello', { cwd: '/home/user/work' })
console.log(res.exitCode, res.stdout)

await dock.docks.files.write(box.id, '/home/user/work/notes/hello.txt', 'hello
')
console.log(await dock.docks.files.read(box.id, '/home/user/work/notes/hello.txt'))
console.log(await dock.docks.files.list(box.id, '/home/user/work/notes')) // ['hello.txt']

const copy = await dock.docks.branch(box.id, { name: 'demo-copy' })
await dock.docks.stop(box.id)
await dock.docks.resume(box.id)

const { operation } = await dock.docks.delete(box.id) // sends the x-confirm-delete header for you
console.log((await dock.operations.get(operation.id)).status)
await dock.docks.delete(copy.id)
```

## API

`new Dock({ apiKey?, baseUrl?, fetch? })`

- `dock.docks.create(params, { idempotencyKey? })`, `list({ filter?, all? })`, `get(id)`, `update(id, params)`
- `dock.docks.exec(id, command, { timeoutSeconds?, env?, cwd? })`
- `dock.docks.stop(id, { force? })`, `resume(id, params)` (both return `{ id, state }`), `branch(id, params, { idempotencyKey? })`: return when the host has finished
- `dock.docks.delete(id)`: returns `{ operation }`; `dock.operations.get(operation.id)` polls it
- `dock.docks.files.write(id, path, content)`, `read(id, path)`, `list(id, path)`

The API has no file routes. The file helpers run one `exec` call: content travels as base64, paths are shell-quoted, and a write is limited to about 48 KB (the 64 KB exec command limit). A non-zero exit or truncated output is a `DockError` with code `file_error`.

Dock responses are typed with only `id`, `name` and `state` required; unknown fields are kept.

## Errors

Every failure throws `DockError` with `code`, `status` and `message`:

```ts
try {
  await dock.docks.get('00000000-0000-4000-8000-000000000000')
} catch (e) {
  if (e instanceof DockError && e.code === 'dock_not_found') console.log(e.status) // 404
}
```

`code` is the API's snake_case code (`dock_not_found`, `validation_error`, `dock_name_taken`, ...). `status` is 0 for failures with no HTTP response: `network_error`, and SDK-side `validation_error` (oversized file content, empty path). Other SDK codes: `missing_api_key`, `invalid_response`, `file_error`; `http_<status>` is used when the server answers without an error envelope.

## Environment variables

| Variable | Meaning | Default |
| --- | --- | --- |
| `DOCK_API_KEY` | API key (`dock_...`) | none (required unless passed) |
| `DOCK_API_URL` | Control-plane origin, without `/v1` | `https://api.usedock.io` |

## Tests and shared scenarios

```sh
bun install
bun run typecheck && bun run lint && bun run build && bun run test
```

The same scenario suite runs in every Dock SDK. It lives in [`sdk-scenarios/`](https://github.com/usedock/dock/tree/main/sdk-scenarios) in usedock/dock; `SCENARIOS_REF` pins the commit these tests target. CI checks usedock/dock out at that commit and sets `DOCK_SCENARIOS_DIR`.

- Offline (default): `test/scenarios.spec.ts` replays every scenario against a local fake HTTP server using the recorded fixtures. Locally, set `DOCK_SCENARIOS_DIR` to a checkout's `sdk-scenarios` directory (default `../dock/sdk-scenarios`); if it is missing the scenario tests are skipped with a warning. In CI (`CI` set) a missing directory fails the run.
- Live: also set `DOCK_API_URL`, `DOCK_API_KEY` and `DOCK_WORKSPACE_ID` and the same scenarios run against a real control plane. They create and delete docks (named `sdk-...`), so use a throwaway workspace.

Bumping the pin: update `SCENARIOS_REF` to the new usedock/dock commit in the same pull request that adapts the SDK.

## Design

- Written by hand, not generated, so names read the way you would say them: `dock.docks.create`, `dock.docks.exec`, `dock.docks.branch`.
- Only public routes. Fleet, admin and internal routes never appear.
- The same nouns and verbs as the [Python](https://github.com/usedock/dock-python) and [Go](https://github.com/usedock/dock-go) SDKs, checked by one shared scenario suite (create, exec, files, stop, resume, branch, delete).
- Semver; a major version matches an API version.

## Contributing

Contributions are welcome. Every contributor signs the CLA; the CLA bot asks on your first pull request in each repository. API changes start in [usedock/dock](https://github.com/usedock/dock) and link their SDK pull requests.

## Security

Report vulnerabilities to [security@usedock.io](mailto:security@usedock.io), not in public issues.

## License

[Apache-2.0](LICENSE).

Copyright (C) 2026 Paranjay.
