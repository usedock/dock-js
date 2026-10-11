// The file helper commands: rendered templates must equal the shared sdk-scenarios fixtures, and
// hostile names must round-trip in a real bash (GNU base64 and find), never run as commands.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fromBase64, listCommand, readCommand, toBase64, writeCommand } from '../src/files.js'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scenariosDir = resolve(repoRoot, process.env.DOCK_SCENARIOS_DIR ?? '../dock/sdk-scenarios')
const fixturePath = join(scenariosDir, 'fixtures', 'files-roundtrip.json')

describe('commands match the sdk-scenarios fixtures', () => {
  it.skipIf(!existsSync(fixturePath) && !process.env.CI)('files-roundtrip.json', () => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
      exchanges: { step: string; request: { body?: { command?: string } } }[]
    }
    const want: Record<string, string> = {
      write: writeCommand('/home/user/work/notes/hello.txt', 'hello from dock\nsecond line\n'),
      read: readCommand('/home/user/work/notes/hello.txt'),
      list: listCommand('/home/user/work/notes'),
    }
    for (const [step, command] of Object.entries(want)) {
      const exchange = fixture.exchanges.find((e) => e.step === step)
      expect(exchange?.request.body?.command, step).toBe(command)
    }
  })
})

const bashOk = (() => {
  const probe = spawnSync('bash', ['-c', 'base64 -w0 </dev/null && find -H . -maxdepth 0'])
  return probe.status === 0
})()
if (!bashOk && process.env.CI) {
  throw new Error('CI must have bash with GNU base64 and find to run the file command tests')
}

const bash = (cwd: string, command: string) => spawnSync('bash', ['-c', command], { cwd, encoding: 'utf8' })

describe.skipIf(!bashOk)('commands run in bash (skipped without bash, GNU base64 and GNU find)', () => {
  const names = [
    "it's.txt",
    '-n.txt',
    'dir with space/$(touch pwned).txt',
    "x'; touch pwned; echo '",
    'new\nline.txt',
    'trailing-newline\n',
    'bang!.txt',
    'dq"quote.txt',
    '-rf/-x',
    'back`tick`.txt',
  ]

  it('write and read round-trip hostile paths', () => {
    const content = "line 1\n'quoted' $HOME `x` é\n"
    for (const name of names) {
      const cwd = mkdtempSync(join(tmpdir(), 'sdk-files-'))
      try {
        const write = bash(cwd, writeCommand(name, content))
        expect(write.status, `${JSON.stringify(name)} write: ${write.stderr}`).toBe(0)
        const read = bash(cwd, readCommand(name))
        expect(read.status, `${JSON.stringify(name)} read: ${read.stderr}`).toBe(0)
        expect(fromBase64(read.stdout), JSON.stringify(name)).toBe(content)
        expect(existsSync(join(cwd, 'pwned'))).toBe(false)
      } finally {
        rmSync(cwd, { recursive: true, force: true })
      }
    }
  })

  it('list returns hostile entry names, hidden ones included, in any order', () => {
    const hostile = ['new\nline', '-n', 'bang!', 'dq"x', "it's", '.hidden', 'trail\n', 'é', 'back`tick`']
    const cwd = mkdtempSync(join(tmpdir(), 'sdk-files-'))
    try {
      // a relative directory that starts with a dash exercises the ./ prefix
      for (const name of hostile) {
        const w = bash(cwd, writeCommand(`-d/${name}`, 'x'))
        expect(w.status, `${JSON.stringify(name)}: ${w.stderr}`).toBe(0)
      }
      const list = bash(cwd, listCommand('-d'))
      expect(list.status, list.stderr).toBe(0)
      const got = list.stdout.split('\n').filter(Boolean).map(fromBase64)
      expect([...got].sort()).toEqual([...hostile].sort())

      // a symlink to a directory lists the target's entries (find -H)
      symlinkSync('-d', join(cwd, 'link'))
      const viaLink = bash(cwd, listCommand('link'))
      expect(viaLink.status, viaLink.stderr).toBe(0)
      expect(viaLink.stdout.split('\n').filter(Boolean)).toHaveLength(hostile.length)

      // an empty directory lists nothing; a missing path or a file exits non-zero
      mkdirSync(join(cwd, 'empty'))
      expect(bash(cwd, listCommand('empty')).stdout).toBe('')
      expect(bash(cwd, listCommand('nope')).status).not.toBe(0)
      expect(bash(cwd, listCommand('-d/.hidden')).status).not.toBe(0)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('base64 helper is the inverse of the decode used for read and list', () => {
    expect(fromBase64(toBase64('a\nb é'))).toBe('a\nb é')
  })
})
