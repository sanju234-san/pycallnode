/** Shared type definitions for the NDJSON protocol and public API. */

// ─── NDJSON protocol messages ────────────────────────────────────────────────

/** Message sent from Node → Python over stdin. */
export interface RequestMessage {
  id: string;
  function: string;
  args: unknown[];
  kwargs: Record<string, unknown>;
}

/** Successful response from Python → Node over stdout. */
export interface SuccessResponse {
  id: string;
  status: 'ok';
  result: unknown;
}

/** Error response from Python → Node over stdout. */
export interface ErrorResponse {
  id: string;
  status: 'error';
  error: string;
  type: string;
  traceback: string;
}

export type ResponseMessage = SuccessResponse | ErrorResponse;

// ─── Public option types ─────────────────────────────────────────────────────

export interface BridgeOptions {
  /** Path to the Python script containing @expose'd functions. */
  pythonScript: string;

  /** Python executable (default: "python3", falls back to "python" on Windows). */
  pythonPath?: string;

  /** Default timeout in ms for every call (default: 30 000). 0 = no timeout. */
  timeout?: number;

  /** Max consecutive crash restarts before giving up (default: 3). */
  maxRestarts?: number;

  /** Extra environment variables passed to the Python process. */
  env?: Record<string, string>;

  /** Current working directory for the Python process. */
  cwd?: string;
}

export interface CallOptions {
  /** Override the default timeout for this single call (ms). 0 = no timeout. */
  timeout?: number;
}

export interface BridgePoolOptions extends BridgeOptions {
  /** Number of worker processes in the pool (default: number of CPUs). */
  size?: number;
}
