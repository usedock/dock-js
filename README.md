# Dock TypeScript SDK

The TypeScript client for [Dock](https://github.com/usedock/dock): isolated Linux machines for agents, on your laptop, your servers, or our cloud.

> **Status:** not released yet. This SDK is being written by hand; the package name `@usedock/sdk` is reserved.

## Install

```sh
npm install @usedock/sdk
```

## Example

```ts
import { Dock } from '@usedock/sdk'

const dock = await Dock.create({ cpus: 2, memory: '4gb', connect: ['github'] })
await dock.exec('git clone acme/api && cd api && bun test')

const [a, b, c] = await dock.branch({ count: 3 })
await dock.stop()
```

The client reads `DOCK_API_KEY` and the current context: a self-hosted control plane, or Dock Cloud (coming soon).

## Design

- Written by hand, not generated, so names read the way you would say them: `docks.create`, `dock.exec`, `dock.branch`.
- Only public routes. Fleet, admin and internal routes never appear.
- The same nouns and verbs as the [Python](https://github.com/usedock/dock-python) and [Go](https://github.com/usedock/dock-go) SDKs, and one shared scenario suite (create, exec, stop, resume, branch, delete) run against a real control plane.
- Semver; a major version matches an API version.

## Contributing

Contributions are welcome. Every contributor signs the CLA once; the CLA bot asks on your first pull request. API changes start in [usedock/dock](https://github.com/usedock/dock) and link their SDK pull requests.

## Security

Report vulnerabilities to [security@usedock.io](mailto:security@usedock.io), not in public issues.

## License

[Apache-2.0](LICENSE).
