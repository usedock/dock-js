/** API error codes added with connectors and the Dockyard catalog. `DockError.code` may carry any other string too. */
export const ErrorCodes = {
  /** 409: a requested connector is not connected in the workspace. */
  connectorNotConnected: 'connector_not_connected',
  /** 403: creating, branching or opening a Dock that uses connectors needs an organization admin (or, to open it, its creator). */
  connectorAdminOnly: 'connector_admin_only',
  /** 404: disconnecting a connector that is not connected. */
  connectorNotFound: 'connector_not_found',
  /** 400: the image name is not in the Dockyard catalog. */
  imageUnknown: 'image_unknown',
  /** 400: the image is in the catalog but no host serves it yet. */
  imageUnavailable: 'image_unavailable',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

/** Raised for every failed call: API error envelopes, transport failures and SDK-side validation. */
export class DockError extends Error {
  /** Stable machine-readable code, for example `dock_not_found` or `validation_error`. */
  readonly code: string
  /** HTTP status, or 0 when no response was received (network failure, local validation). */
  readonly status: number

  constructor(code: string, message: string, status: number, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DockError'
    this.code = code
    this.status = status
  }
}
