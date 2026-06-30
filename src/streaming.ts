import { EventEmitter } from 'node:events';
import { Bridge } from './bridge.js';

export class PyStream extends EventEmitter {
  public readonly bridge: Bridge;
  public readonly callId: string;
  private queue: unknown[] = [];
  private resolver: ((value: IteratorResult<unknown>) => void) | null = null;
  private finished = false;
  private error: Error | null = null;

  constructor(bridge: Bridge, callId: string) {
    super();
    this.bridge = bridge;
    this.callId = callId;
  }

  /**
   * Pushes a chunk to the stream.
   */
  push(data: unknown): void {
    this.emit('data', data);
    if (this.resolver) {
      this.resolver({ value: data, done: false });
      this.resolver = null;
    } else {
      this.queue.push(data);
    }
  }

  /**
   * Ends the stream.
   */
  end(): void {
    this.finished = true;
    this.emit('end');
    if (this.resolver) {
      this.resolver({ value: undefined, done: true });
      this.resolver = null;
    }
  }

  /**
   * Flags an error.
   */
  destroy(err: Error): void {
    this.error = err;
    this.emit('error', err);
    if (this.resolver) {
      // Resolve the waiting promise to terminate the loop
      this.resolver({ value: undefined, done: true });
      this.resolver = null;
    }
  }

  /**
   * Implements AsyncIterator interface.
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<unknown, void, unknown> {
    while (!this.finished || this.queue.length > 0) {
      if (this.error) {
        throw this.error;
      }
      if (this.queue.length > 0) {
        yield this.queue.shift();
      } else if (this.finished) {
        return;
      } else {
        const nextResult = await new Promise<IteratorResult<unknown>>((resolve, reject) => {
          this.resolver = resolve;
          this.once('error', reject);
        });
        if (nextResult.done) return;
        yield nextResult.value;
      }
    }
  }
}
