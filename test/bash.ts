// Picks the bash used by the file command tests. On Windows a bare `bash` can resolve to the WSL
// launcher (System32 or WindowsApps), which must never be started, so only an explicit
// DOCK_TEST_BASH or a Git Bash install is used there; elsewhere `bash` from PATH is fine.
import { existsSync } from 'node:fs'
import { win32 } from 'node:path'

export type BashResolution = { bash: string; env: NodeJS.ProcessEnv } | { bash: null; reason: string }

const GIT_BASH_CANDIDATES = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
]

// Relative to %USERPROFILE%.
const SCOOP_SUFFIXES = [
  '\\scoop\\apps\\git\\current\\usr\\bin\\bash.exe',
  '\\scoop\\apps\\git\\current\\bin\\bash.exe',
]

/** True for paths that may be the WSL launcher (System32, SysWOW64, Sysnative or WindowsApps). */
export function isWslLauncherPath(path: string): boolean {
  const p = path.replace(/\//g, '\\').toLowerCase()
  return /\\windows\\(system32|syswow64|sysnative)\\/.test(p) || p.includes('\\windowsapps\\')
}

/**
 * A drive-letter absolute path made only of plain segments, outside the launcher directories.
 * Windows drops `.`, `..`, empty and trailing-dot segments and expands 8.3 names (WINDOW~1), so
 * anything else could slip past the text check above.
 */
export function isSafeWindowsBash(path: string): boolean {
  const n = path.replace(/\//g, '\\').toLowerCase()
  if (!/^[a-z]:\\/.test(n)) return false
  const segs = n.split('\\').slice(1)
  if (segs.some((s) => s === '' || s.endsWith('.') || s.endsWith(' ') || s.includes('~'))) return false
  return !isWslLauncherPath(n)
}

export function resolveBash(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): BashResolution {
  if (platform !== 'win32') return { bash: 'bash', env }
  const explicit = env.DOCK_TEST_BASH
  let bash: string | undefined
  if (explicit) {
    if (!isSafeWindowsBash(explicit)) {
      return {
        bash: null,
        reason: `DOCK_TEST_BASH must be a plain absolute path outside System32, SysWOW64, Sysnative and WindowsApps (got ${explicit})`,
      }
    }
    if (!exists(explicit)) return { bash: null, reason: `DOCK_TEST_BASH does not exist (${explicit})` }
    bash = explicit
  } else {
    const profile = env.USERPROFILE
    const candidates = [...GIT_BASH_CANDIDATES, ...(profile ? SCOOP_SUFFIXES.map((s) => profile + s) : [])]
    bash = candidates.find((c) => exists(c))
    if (!bash) {
      return { bash: null, reason: 'no Git Bash found; set DOCK_TEST_BASH to an absolute Git Bash path' }
    }
  }
  // Put Git's usr\bin first so `find` and `base64` are the GNU tools, not C:\Windows\System32\find.exe.
  // A bash.exe already in usr\bin means that directory is the one to prepend.
  const dir = win32.dirname(bash)
  const usrBin = /\\usr\\bin$/i.test(dir) ? dir : win32.resolve(dir, '..', 'usr', 'bin')
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  const path = [...new Set([usrBin, dir]), env[pathKey]].filter(Boolean).join(win32.delimiter)
  return { bash, env: { ...env, [pathKey]: path } }
}
