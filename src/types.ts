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
  /** Connector kinds the Dock may use through the connector gateway. */
  connectors?: string[]
  [key: string]: unknown
}

export interface CreateDockParams {
  workspaceId?: string
  name?: string
  image?: string
  cpus?: number
  memoryMiB?: number
  diskGiB?: number
  /** Seconds after ready before auto-stop; `null` disables auto-stop. */
  ttlSeconds?: number | null
  /** Environment variables stored on the Dock. */
  env?: Record<string, string>
  /** Name of a saved environment to apply. */
  environment?: string
  /** Skip the workspace default environment. */
  noEnv?: boolean
  /** Connector kinds to attach (at most 4); each must be connected in the workspace. */
  connectors?: ConnectorKind[]
  [key: string]: unknown
}

export interface UpdateDockParams {
  name?: string
  cpus?: number
  memoryMiB?: number
  diskGiB?: number
  /** Seconds after ready before auto-stop; `null` disables auto-stop. */
  ttlSeconds?: number | null
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
  /** Seconds after ready before auto-stop; `null` disables auto-stop. */
  ttlSeconds?: number | null
  environment?: string
  noEnv?: boolean
}

export interface BranchParams {
  name?: string
  image?: string
  cpus?: number
  memoryMiB?: number
  diskGiB?: number
  /** Seconds after ready before auto-stop; `null` disables auto-stop. */
  ttlSeconds?: number | null
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
  status: string
  targetType?: string
  targetId?: string
  [key: string]: unknown
}

/** What `docks.delete` returns: the API wraps the operation as `{ operation }`. */
export interface DeleteDockResult {
  operation: Operation
  [key: string]: unknown
}

/** What `docks.stop` and `docks.resume` return: only the id and the new state. */
export interface DockStateResult {
  id: string
  state: string
  [key: string]: unknown
}

export interface WriteFileResult {
  path: string
}

/** Tool connectors a Dock can use. The API may add kinds; `string` is accepted wherever a kind is. */
export type ConnectorKind = 'figma' | 'linear' | 'slack' | 'sentry' | (string & {})

/** A workspace connector as `connectors.list` and `connectors.connect` return it. Tokens are never returned. */
export interface Connector {
  kind: string
  /** `tool` for token or OAuth connectors; `github` and `model-keys` are read-only entries. */
  type: 'tool' | 'github' | 'model-keys' | (string & {})
  status: 'connected' | 'not_connected' | 'reauth_required' | (string & {})
  accountLabel: string | null
  scopes: string[]
  oauthAvailable: boolean
  readOnly: boolean
  updatedAt: string | null
  [key: string]: unknown
}

export interface ConnectConnectorParams {
  /** Personal or bot token, 1-2048 characters; the API verifies it with the vendor. */
  token: string
}

/** What `connectors.disconnect` returns. */
export interface DisconnectConnectorResult {
  kind: string
  status: 'not_connected'
  [key: string]: unknown
}

/** A Dockyard image as `images.list` returns it. */
export interface DockyardImage {
  name: string
  description: string
  arch: string[]
  sizeMiB: number
  contents: string
  /** Whether a host in the fleet currently serves the image. */
  available: boolean
  [key: string]: unknown
}

/** Who may open a port URL: `private` needs a Dock credential or an organization member sign-in, `public` is open. */
export type PortVisibility = 'public' | 'private'

/** An exposed Dock port as `docks.ports.list` and `docks.ports.expose` return it. */
export interface Port {
  port: number
  /** Ports exposed before visibility existed read as `public`. */
  visibility: PortVisibility
  /** Null while hosted ports are off on this deployment. */
  url: string | null
  createdAt: string
  [key: string]: unknown
}

export interface ExposePortParams {
  /** Defaults to `private` for a new port; for an exposed port, omitting it keeps the current visibility. */
  visibility?: PortVisibility
}

/** What `docks.ports.remove` returns. */
export interface RemovePortResult {
  deleted: boolean
  [key: string]: unknown
}
