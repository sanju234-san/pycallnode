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

import { EnvManager } from './envmanager.js';
import { InferenceBridge } from './inference.js';
import { EmbeddingGenerator } from './embeddings.js';
import { RAGConnector } from './rag.js';
import { VisionBridge } from './vision.js';
import { PyStream } from './streaming.js';

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
  private streams = new Map<string, PyStream>();
  private restartCount = 0;
  private destroyed = false;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;
  private stderrChunks: string[] = [];
  private _exposedFunctions: string[] = [];

  public readonly envManager: EnvManager;
  public readonly inference: InferenceBridge;

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

    this.envManager = new EnvManager({
      pythonPath: this.opts.pythonPath,
      autoInstall: options.autoInstall ?? false,
      requiredPackages: options.requiredPackages ?? [],
    });

    this.inference = new InferenceBridge(this);

    this.init();
  }

  get rag(): RAGConnector {
    return new RAGConnector(this);
  }

  get embeddings(): EmbeddingGenerator {
    return new EmbeddingGenerator(this);
  }

  get vision(): VisionBridge {
    return new VisionBridge(this);
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

  /**
   * Call a function in a dynamic Python module.
   *
   * @param module  - Python module name.
   * @param func    - Function name inside module.
   * @param args    - Positional arguments.
   * @param kwargs  - Keyword arguments.
   * @param options - Per-call options.
   */
  async call(
    module: string,
    func: string,
    args?: unknown[],
    kwargs?: Record<string, unknown>,
    options?: CallOptions,
  ): Promise<unknown>;

  async call(
    fnOrModule: string,
    ...rest: unknown[]
  ): Promise<unknown> {
    await this.ready();

    let fn: string;
    let module: string | undefined;
    let args: unknown[] = [];
    let kwargs: Record<string, unknown> | undefined;
    let timeout = this.opts.timeout;

    // Check if it is a dynamic module call.
    // It is dynamic if rest[0] is a string AND fnOrModule is not a registered exposed function.
    const isDynamic = typeof rest[0] === 'string' && !this._exposedFunctions.includes(fnOrModule);

    if (isDynamic) {
      // call(module, func, args, kwargs, options)
      module = fnOrModule;
      fn = rest[0] as string;
      args = (rest[1] as unknown[]) ?? [];
      kwargs = rest[2] as Record<string, unknown>;
      const options = rest[3] as CallOptions | undefined;
      timeout = options?.timeout ?? timeout;
    } else {
      // call(fn, ...args) or call(fn, args, options)
      fn = fnOrModule;
      if (
        rest.length === 2 &&
        Array.isArray(rest[0]) &&
        typeof rest[1] === 'object' &&
        rest[1] !== null &&
        'timeout' in rest[1]
      ) {
        args = rest[0] as unknown[];
        timeout = (rest[1] as CallOptions).timeout ?? timeout;
      } else {
        args = rest;
      }
    }

    return this.sendRequest(fn, args, timeout, kwargs, module);
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

  /**
   * Streams output from a Python generator.
   */
  stream(
    module: string,
    func: string,
    args: unknown[] = [],
    kwargs: Record<string, unknown> = {},
  ): PyStream {
    if (this.destroyed) {
      throw new PyProcessError('Bridge has been destroyed', null, '');
    }

    const callId = uuidv4();
    const stream = new PyStream(this, callId);
    this.streams.set(callId, stream);

    const msg: RequestMessage = {
      id: callId,
      type: 'stream',
      module,
      function: func,
      args,
      kwargs,
    };

    if (!this.proc?.stdin?.writable) {
      stream.destroy(new PyProcessError('Python process stdin is not writable', null, ''));
      this.streams.delete(callId);
      return stream;
    }

    const line = JSON.stringify(msg) + '\n';
    this.proc.stdin.write(line, 'utf-8', (err) => {
      if (err) {
        stream.destroy(new PyProcessError(`Failed to write to stdin: ${err.message}`, null, ''));
        this.streams.delete(callId);
      }
    });

    return stream;
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

    // Destroy all active streams
    for (const [id, stream] of this.streams) {
      stream.destroy(new PyProcessError('Bridge destroyed while stream was active', null, ''));
      this.streams.delete(id);
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

  private init(): void {
    this.readyPromise = (async () => {
      if (this.destroyed) return;
      try {
        await this.envManager.setup();
        this.opts.pythonPath = this.envManager.pythonPath;
        await this.spawn();
      } catch (err: any) {
        this.readyReject?.(err);
        throw err;
      }
    })();
  }

  private spawn(): Promise<void> {
    this.stderrChunks = [];

    const spawnPromise = new Promise<void>((res, rej) => {
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

    return spawnPromise;
  }

  private handleLine(line: string): void {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // ignore non-JSON lines (e.g. Python print() debug output)
    }

    const callId = msg.id;

    // Handle the ready signal
    if (callId === '__ready__' && msg.status === 'ok') {
      this._exposedFunctions = msg.result as string[] ?? [];
      this.restartCount = 0; // successful start resets counter
      this.readyResolve?.();
      this.emit('ready', this._exposedFunctions);
      return;
    }

    // Handle stream chunks/end
    if (msg.type === 'chunk' || msg.type === 'end') {
      const stream = this.streams.get(callId);
      if (stream) {
        if (msg.type === 'chunk') {
          stream.push(msg.result);
        } else {
          stream.end();
          this.streams.delete(callId);
        }
      }
      return;
    }

    const pending = this.pending.get(callId);
    if (!pending) {
      // Might be a stream error
      const stream = this.streams.get(callId);
      if (stream && msg.status === 'error') {
        stream.destroy(new PyRuntimeError(msg.error, msg.type, msg.traceback));
        this.streams.delete(callId);
      }
      return;
    }

    if (pending.timer) clearTimeout(pending.timer);
    this.pending.delete(callId);

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

    // Destroy all active streams
    for (const [id, stream] of this.streams) {
      stream.destroy(new PyProcessError(`Python process exited unexpectedly (code=${code})`, code, stderr));
      this.streams.delete(id);
    }

    this.rl?.close();

    this.emit('exit', code, signal);

    // Attempt auto-restart with exponential backoff unless destroyed
    if (!this.destroyed && this.restartCount < this.opts.maxRestarts) {
      const count = ++this.restartCount;
      this.emit('restart', count);
      
      const delay = Math.min(Math.pow(2, count - 1) * 1000, 10000);
      
      setTimeout(() => {
        if (!this.destroyed) {
          this.spawn().catch((err) => {
            this.emit('error', err);
          });
        }
      }, delay);
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
    module?: string,
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
        type: 'call',
        module,
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
