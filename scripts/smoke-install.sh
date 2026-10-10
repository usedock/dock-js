#!/usr/bin/env bash
# Installs @usedock/sdk into a throwaway project with npm and checks that it
# imports at runtime and type-checks. Usage: scripts/smoke-install.sh <npm-install-spec>
# e.g. a path, a tarball, or git+file:///abs/path/to/repo (committed HEAD only).
set -euo pipefail

spec="${1:?usage: smoke-install.sh <npm-install-spec>}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"

cat > package.json <<'JSON'
{ "name": "smoke", "version": "0.0.0", "private": true, "type": "module" }
JSON
npm install --no-audit --no-fund "$spec"
npm install --no-audit --no-fund --save-dev typescript@5 @types/node@22

test -f node_modules/@usedock/sdk/dist/index.js
test -f node_modules/@usedock/sdk/dist/index.d.ts

cat > index.mjs <<'JS'
import { Dock, DockError } from '@usedock/sdk'

const dock = new Dock({ apiKey: 'test', baseUrl: 'http://localhost:1' })
if (typeof dock.docks.list !== 'function') throw new Error('docks.list missing')
if (typeof DockError !== 'function') throw new Error('DockError missing')
console.log('runtime import ok')
JS
node index.mjs

cat > check.ts <<'TS'
import { Dock, DockError } from '@usedock/sdk'
import type { DockOptions } from '@usedock/sdk'

const options: DockOptions = { apiKey: 'test' }
const dock: Dock = new Dock(options)
const list: Promise<unknown> = dock.docks.list()
list.catch(() => {})
export const isErr = (e: unknown): boolean => e instanceof DockError
TS
cat > tsconfig.json <<'JSON'
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "es2022",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": false,
    "types": ["node"]
  },
  "include": ["check.ts"]
}
JSON
npx tsc -p tsconfig.json
echo "type check ok"
