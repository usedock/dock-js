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
