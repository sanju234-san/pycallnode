import { ChildProcess, spawn } from 'node:child_process';
import { createInterface, Interface as ReadlineInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4 } from 'uuid';

import {
  PyCallNodeError,
  PyTimeoutError,
  PyProcessError,
  PyRuntimeError,
} from './errors.js';

import type {
  BridgeOptions,
  CallOptions,
  RequestMessage,
  ResponseMessage,
} from './types.js';

// Resolve the bundled bridge_runner.py relative to this file
const __dirname_resolved =
  typeof __dirname !== 'undefined'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));

const DEFAULT_BRIDGE_RUNNER = resolve(
  __dirname_resolved,
  '..',
  'python',
  'bridge_runner.py',
);

/** Default Python executable – prefer python3 except on Windows. */
const DEFAULT_PYTHON =
  process.platform === 'win32' ? 'python' : 'python3';

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout> | null;
  functionName: string;
}

/**
 * A Bridge manages a single Python subprocess and exposes a
 * promise-based `call()` method for invoking @expose'd Python functions.
 */
export class Bridge extends EventEmitter {
  private readonly opts: Required<
    Pick<BridgeOptions, 'pythonScript' | 'pythonPath' | 'timeout' | 'maxRestarts'>
  > & Pick<BridgeOptions, 'env' | 'cwd'>;

  private proc: ChildProcess | null = null;
  private rl: ReadlineInterface | null = null;
  private pending = new Map<string, PendingCall>();
  private restartCount = 0;
  private destroyed = false;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;
  private stderrChunks: string[] = [];
  private _exposedFunctions: string[] = [];

  constructor(options: BridgeOptions) {
    super();

    this.opts = {
      pythonScript: resolve(options.pythonScript),
      pythonPath: options.pythonPath ?? DEFAULT_PYTHON,
      timeout: options.timeout ?? 30_000,
      maxRestarts: options.maxRestarts ?? 3,
      env: options.env,
      cwd: options.cwd,
    };

    this.spawn();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** List of function names exposed by the Python script. Available after ready(). */
  get exposedFunctions(): readonly string[] {
    return this._exposedFunctions;
  }

  /** Resolves when the Python process is ready to accept calls. */
  async ready(): Promise<void> {
    if (this.destroyed) {
      throw new PyProcessError('Bridge has been destroyed', null, '');
    }
    return this.readyPromise!;
  }

  /**
   * Call an @expose'd Python function.
   *
   * @param fn    - Function name registered in Python.
   * @param args  - Positional arguments forwarded to Python.
   * @returns       The JSON-serialisable return value from Python.
   */
  async call(fn: string, ...args: unknown[]): Promise<unknown>;

  /**
   * Call with explicit options.
   *
   * @param fn      - Function name.
   * @param args    - Positional arguments.
   * @param options - Per-call options (e.g. timeout override).
   */
  async call(
    fn: string,
    args: unknown[],
    options: CallOptions,
  ): Promise<unknown>;

  async call(
    fn: string,
    ...rest: unknown[]
  ): Promise<unknown> {
    await this.ready();

    let args: unknown[];
    let timeout = this.opts.timeout;

    // Determine calling convention
    if (
      rest.length === 2 &&
      Array.isArray(rest[0]) &&
      typeof rest[1] === 'object' &&
      rest[1] !== null &&
      'timeout' in rest[1]
    ) {
      // call(fn, [...args], { timeout })
      args = rest[0] as unknown[];
      timeout = (rest[1] as CallOptions).timeout ?? timeout;
    } else {
      // call(fn, arg1, arg2, ...)
      args = rest;
    }

    return this.sendRequest(fn, args, timeout);
  }

  /**
   * Call with keyword arguments.
   */
  async callWithKwargs(
    fn: string,
    args: unknown[],
    kwargs: Record<string, unknown>,
    options?: CallOptions,
  ): Promise<unknown> {
    await this.ready();
    const timeout = options?.timeout ?? this.opts.timeout;
    return this.sendRequest(fn, args, timeout, kwargs);
  }

  /** Gracefully shut down the Python process. */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    // Reject all pending calls
    for (const [id, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(
        new PyProcessError('Bridge destroyed while call was pending', null, ''),
      );
      this.pending.delete(id);
    }

    // Close stdin to signal the Python process to exit
    if (this.proc) {
      this.proc.stdin?.end();
      this.rl?.close();

      // Give the process a moment to exit cleanly, then force-kill
      await new Promise<void>((res) => {
        const killTimer = setTimeout(() => {
          this.proc?.kill('SIGKILL');
          res();
        }, 2000);

        this.proc?.once('exit', () => {
          clearTimeout(killTimer);
          res();
        });
      });

      this.proc = null;
    }

    this.emit('destroy');
    this.removeAllListeners();
  }

  /** Whether the bridge has been destroyed. */
  get isDestroyed(): boolean {
    return this.destroyed;
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private spawn(): void {
    this.stderrChunks = [];

    this.readyPromise = new Promise<void>((res, rej) => {
      this.readyResolve = res;
      this.readyReject = rej;
    });

    const env: Record<string, string> = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      ...(this.opts.env ?? {}),
    } as Record<string, string>;

    this.proc = spawn(
      this.opts.pythonPath,
      [DEFAULT_BRIDGE_RUNNER, this.opts.pythonScript],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        cwd: this.opts.cwd,
      },
    );

    // Capture stderr for diagnostics
    this.proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      this.stderrChunks.push(text);
      this.emit('stderr', text);
    });

    // Parse NDJSON responses from stdout
    this.rl = createInterface({ input: this.proc.stdout! });
    this.rl.on('line', (line: string) => this.handleLine(line));

    // Handle process exit
    this.proc.on('exit', (code, signal) => this.handleExit(code, signal));
    this.proc.on('error', (err: Error) => this.handleSpawnError(err));
  }

  private handleLine(line: string): void {
    let msg: ResponseMessage;
    try {
      msg = JSON.parse(line) as ResponseMessage;
    } catch {
      return; // ignore non-JSON lines (e.g. Python print() debug output)
    }

    // Handle the ready signal
    if (msg.id === '__ready__' && msg.status === 'ok') {
      this._exposedFunctions = (msg as any).result as string[] ?? [];
      this.restartCount = 0; // successful start resets counter
      this.readyResolve?.();
      this.emit('ready', this._exposedFunctions);
      return;
    }

    const pending = this.pending.get(msg.id);
    if (!pending) return; // orphan response (e.g. after timeout)

    if (pending.timer) clearTimeout(pending.timer);
    this.pending.delete(msg.id);

    if (msg.status === 'ok') {
      pending.resolve(msg.result);
    } else {
      pending.reject(
        new PyRuntimeError(msg.error, msg.type, msg.traceback),
      );
    }
  }

  private handleExit(code: number | null, signal: string | null): void {
    const stderr = this.stderrChunks.join('');

    // Reject the ready promise if process hasn't become ready yet
    this.readyReject?.(
      new PyProcessError(
        `Python process exited (code=${code}, signal=${signal})`,
        code,
        stderr,
      ),
    );

    // Reject all pending calls
    for (const [id, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(
        new PyProcessError(
          `Python process exited unexpectedly (code=${code})`,
          code,
          stderr,
        ),
      );
    }
    this.pending.clear();
    this.rl?.close();

    this.emit('exit', code, signal);

    // Attempt auto-restart unless destroyed
    if (!this.destroyed && this.restartCount < this.opts.maxRestarts) {
      this.restartCount++;
      this.emit('restart', this.restartCount);
      this.spawn();
    } else if (!this.destroyed) {
      this.emit('crash', new PyProcessError(
        `Python process crashed ${this.opts.maxRestarts + 1} times; giving up`,
        code,
        stderr,
      ));
    }
  }

  private handleSpawnError(err: Error): void {
    this.readyReject?.(
      new PyProcessError(`Failed to spawn Python: ${err.message}`, null, ''),
    );
  }

  private sendRequest(
    fn: string,
    args: unknown[],
    timeoutMs: number,
    kwargs?: Record<string, unknown>,
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (this.destroyed) {
        reject(new PyProcessError('Bridge has been destroyed', null, ''));
        return;
      }

      if (!this.proc?.stdin?.writable) {
        reject(new PyProcessError('Python process stdin is not writable', null, ''));
        return;
      }

      const id = uuidv4();
      const msg: RequestMessage = {
        id,
        function: fn,
        args,
        kwargs: kwargs ?? {},
      };

      let timer: ReturnType<typeof setTimeout> | null = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          const pending = this.pending.get(id);
          if (pending) {
            this.pending.delete(id);
            pending.reject(new PyTimeoutError(fn, timeoutMs));
          }
        }, timeoutMs);
      }

      this.pending.set(id, { resolve, reject, timer, functionName: fn });

      const line = JSON.stringify(msg) + '\n';
      this.proc.stdin.write(line, 'utf-8', (err) => {
        if (err) {
          if (timer) clearTimeout(timer);
          this.pending.delete(id);
          reject(new PyProcessError(`Failed to write to stdin: ${err.message}`, null, ''));
        }
      });
    });
  }
}
