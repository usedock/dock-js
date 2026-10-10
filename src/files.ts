import { DockError } from './errors.js'

/** The API caps an exec command at 64 KB. */
export const MAX_COMMAND_LENGTH = 64 * 1024

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

export function writeCommand(path: string, content: string): string {
  const quoted = shellQuote(path)
  const command = `mkdir -p -- "$(dirname -- ${quoted})" && printf '%s' '${toBase64(content)}' | base64 -d > ${quoted}`
  if (command.length > MAX_COMMAND_LENGTH) {
    throw new DockError(
      'validation_error',
      `File content is too large for one write (command would be ${command.length} bytes, limit ${MAX_COMMAND_LENGTH}; about 48 KB of content)`,
      0,
    )
  }
  return command
}

export const readCommand = (path: string) => `base64 -w0 -- ${shellQuote(path)}`

export const listCommand = (path: string) => `ls -1A -- ${shellQuote(path)}`

export function assertPath(path: string): void {
  if (typeof path !== 'string' || path === '' || path.includes('\0')) {
    throw new DockError('validation_error', 'path must be a non-empty string without NUL bytes', 0)
  }
}
