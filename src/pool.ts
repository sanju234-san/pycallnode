import os from 'node:os';
import { EventEmitter } from 'node:events';

import { Bridge } from './bridge.js';
import { PyCallNodeError, PyProcessError } from './errors.js';

import type { BridgePoolOptions, CallOptions } from './types.js';

/**
 * A round-robin pool of Bridge workers for parallel Python workloads.
 *
 * Usage:
 *   const pool = new BridgePool({ pythonScript: 'worker.py', size: 4 });
 *   await pool.ready();
 *   const result = await pool.call('compute', data);
 *   await pool.destroy();
 */
export class BridgePool extends EventEmitter {
  private readonly workers: Bridge[];
  private readonly size: number;
  private idx = 0;
  private destroyed = false;

  constructor(options: BridgePoolOptions) {
    super();

    this.size = options.size ?? os.cpus().length;
    if (this.size < 1) {
      throw new PyCallNodeError('Pool size must be at least 1');
    }

    // Strip pool-only fields and forward the rest to each Bridge
    const { size: _, ...bridgeOpts } = options;

    this.workers = Array.from({ length: this.size }, () => {
      const w = new Bridge(bridgeOpts);
      // Bubble events
      w.on('stderr', (text: string) => this.emit('stderr', text));
      w.on('restart', (count: number) => this.emit('restart', count));
      w.on('crash', (err: Error) => this.emit('crash', err));
      return w;
    });
  }

  /** Resolves when *every* worker in the pool is ready. */
  async ready(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.ready()));
  }

  /** Call a Python function on the next worker (round-robin). */
  async call(fn: string, ...args: unknown[]): Promise<unknown>;
  async call(fn: string, args: unknown[], options: CallOptions): Promise<unknown>;
  async call(fn: string, ...rest: unknown[]): Promise<unknown> {
    if (this.destroyed) {
      throw new PyProcessError('Pool has been destroyed', null, '');
    }

    const worker = this.next();
    return (worker.call as (...a: unknown[]) => Promise<unknown>)(fn, ...rest);
  }

  /** Call with keyword arguments on the next worker. */
  async callWithKwargs(
    fn: string,
    args: unknown[],
    kwargs: Record<string, unknown>,
    options?: CallOptions,
  ): Promise<unknown> {
    if (this.destroyed) {
      throw new PyProcessError('Pool has been destroyed', null, '');
    }
    const worker = this.next();
    return worker.callWithKwargs(fn, args, kwargs, options);
  }

  /** Destroy all workers. */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    await Promise.all(this.workers.map((w) => w.destroy()));
    this.removeAllListeners();
  }

  /** Number of workers in the pool. */
  get poolSize(): number {
    return this.size;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /** Round-robin worker selection. */
  private next(): Bridge {
    const worker = this.workers[this.idx % this.size]!;
    this.idx = (this.idx + 1) % this.size;
    return worker;
  }
}
