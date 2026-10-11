import { DockError } from './errors.js'

/** The API caps an exec command at 64 KB, counted in UTF-8 bytes. */
export const MAX_COMMAND_BYTES = 64 * 1024

/** One POSIX shell word: single-quoted, each `'` written as `'\''`. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

export function toBase64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

export function fromBase64(text: string): string {
  return Buffer.from(text, 'base64').toString('utf8')
}

/**
 * Renders the docks.files.write template of sdk-scenarios/ops.yaml. dirname runs with an "x"
 * sentinel so a path ending in a newline keeps it ($(...) would strip it); "${d%??}" then drops
 * the sentinel and its newline.
 */
export function writeCommand(path: string, content: string): string {
  const q = shellQuote(path)
  return `d=$(dirname -- ${q}; echo x) && mkdir -p -- "\${d%??}" && printf '%s' '${toBase64(content)}' | base64 -d > ${q}`
}

/** Renders the docks.files.read template. */
export const readCommand = (path: string) => `base64 -w0 -- ${shellQuote(path)}`

/**
 * Renders the docks.files.list template: a relative path gets ./ so find never reads it as an
 * expression, -H follows a symlinked directory, and each entry name is printed base64-encoded on
 * its own line.
 */
export const listCommand = (path: string) =>
  `p=${shellQuote(path)} && case $p in /*) ;; *) p=./$p ;; esac && test -d "$p" && find -H "$p" -mindepth 1 -maxdepth 1 -exec sh -c 'for f; do printf "%s" "\${f##*/}" | base64 -w0; echo; done' sh {} +`

/** Raises `file_too_large` when the rendered command exceeds the exec limit (UTF-8 bytes). */
export function assertCommandSize(command: string): void {
  const bytes = Buffer.byteLength(command, 'utf8')
  if (bytes > MAX_COMMAND_BYTES) {
    throw new DockError(
      'file_too_large',
      `File command is too large (${bytes} bytes, limit ${MAX_COMMAND_BYTES}; a write holds about 48 KB of content)`,
      0,
    )
  }
}

export function assertPath(path: string): void {
  if (typeof path !== 'string' || path === '' || path.includes('\0')) {
    throw new DockError('validation_error', 'path must be a non-empty string without NUL bytes', 0)
  }
}
