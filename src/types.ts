/** A Dock. Only `id`, `name` and `state` are guaranteed; other fields may be absent or new. */
export interface DockInfo {
  id: string
  name: string
  state: string
  workspaceId?: string
  cpus?: number
  memoryMiB?: number
  diskGiB?: number
  image?: string
  runtime?: string
  persistentPaths?: string[]
  [key: string]: unknown
}

export interface CreateDockParams {
  workspaceId?: string
  name?: string
  image?: string
  cpus?: number
  memoryMiB?: number
  diskGiB?: number
  ttlSeconds?: number
  /** Environment variables stored on the Dock. */
  env?: Record<string, string>
  /** Name of a saved environment to apply. */
  environment?: string
  /** Skip the workspace default environment. */
  noEnv?: boolean
  [key: string]: unknown
}

export interface UpdateDockParams {
  name?: string
  cpus?: number
  memoryMiB?: number
  diskGiB?: number
  ttlSeconds?: number
}

export interface ListDocksParams {
  filter?: string
  all?: boolean
}

export interface ExecOptions {
  timeoutSeconds?: number
  /** Variables for this call only; never stored on the Dock. */
  env?: Record<string, string>
  /** Absolute working directory. */
  cwd?: string
}

export interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
  durationMs?: number
  truncated?: boolean
  [key: string]: unknown
}

export interface StopOptions {
  force?: boolean
}

export interface ResumeParams {
  cpus?: number
  memoryMiB?: number
  diskGiB?: number
  ttlSeconds?: number
  environment?: string
  noEnv?: boolean
}

export interface BranchParams {
  name?: string
  image?: string
  cpus?: number
  memoryMiB?: number
  diskGiB?: number
  ttlSeconds?: number
  env?: Record<string, string>
  environment?: string
  noEnv?: boolean
}

/** Sent as the `idempotency-key` header on create and branch; a retry returns the original Dock. */
export interface IdempotencyOptions {
  idempotencyKey?: string
}

/** Pollable receipt for accepted work such as delete. */
export interface Operation {
  id: string
  status?: string
  [key: string]: unknown
}

export interface WriteFileResult {
  path: string
}
