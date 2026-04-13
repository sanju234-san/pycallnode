/**
 * Custom error hierarchy for py-callnode.
 *
 * PyCallNodeError (base)
 * ├── PyTimeoutError   – call exceeded its deadline
 * ├── PyProcessError   – Python process crashed / exited unexpectedly
 * └── PyRuntimeError   – Python raised an exception during execution
 */

/** Base error for every py-callnode failure. */
export class PyCallNodeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PyCallNodeError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The Python call did not complete within the configured timeout. */
export class PyTimeoutError extends PyCallNodeError {
  public readonly timeoutMs: number;

  constructor(functionName: string, timeoutMs: number, options?: ErrorOptions) {
    super(
      `Call to "${functionName}" timed out after ${timeoutMs}ms`,
      options,
    );
    this.name = 'PyTimeoutError';
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The Python subprocess exited unexpectedly or could not be spawned. */
export class PyProcessError extends PyCallNodeError {
  public readonly exitCode: number | null;
  public readonly stderr: string;

  constructor(
    message: string,
    exitCode: number | null,
    stderr: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PyProcessError';
    this.exitCode = exitCode;
    this.stderr = stderr;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Python executed the function but raised an exception. */
export class PyRuntimeError extends PyCallNodeError {
  public readonly pythonType: string;
  public readonly pythonTraceback: string;

  constructor(
    message: string,
    pythonType: string,
    pythonTraceback: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PyRuntimeError';
    this.pythonType = pythonType;
    this.pythonTraceback = pythonTraceback;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
