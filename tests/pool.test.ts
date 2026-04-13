/**
 * Integration tests for BridgePool – round-robin distribution.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { BridgePool } from '../src/pool.js';
import { PyCallNodeError, PyProcessError } from '../src/errors.js';

const WORKER = resolve(__dirname, 'fixtures', 'worker.py');

let activePools: BridgePool[] = [];

function createPool(opts: Partial<ConstructorParameters<typeof BridgePool>[0]> = {}) {
  const pool = new BridgePool({
    pythonScript: WORKER,
    pythonPath: 'python',
    size: 2,
    ...opts,
  });
  activePools.push(pool);
  return pool;
}

afterEach(async () => {
  await Promise.all(activePools.map((p) => p.destroy()));
  activePools = [];
});

describe('BridgePool', () => {
  it('should ready() all workers', async () => {
    const pool = createPool({ size: 3 });
    await pool.ready(); // should not throw
    expect(pool.poolSize).toBe(3);
  });

  it('should distribute calls round-robin', async () => {
    const pool = createPool({ size: 2 });
    await pool.ready();

    // Fire several calls – they should round-robin across 2 workers
    const results = await Promise.all([
      pool.call('add', 1, 1),
      pool.call('add', 2, 2),
      pool.call('add', 3, 3),
      pool.call('add', 4, 4),
    ]);

    expect(results).toEqual([2, 4, 6, 8]);
  });

  it('should support callWithKwargs', async () => {
    const pool = createPool({ size: 2 });
    await pool.ready();

    const result = await pool.callWithKwargs(
      'identity_kwargs',
      [],
      { x: 10 },
    );
    expect(result).toEqual({ x: 10 });
  });

  it('should reject calls after destroy()', async () => {
    const pool = createPool();
    await pool.ready();
    await pool.destroy();
    activePools = activePools.filter((p) => p !== pool);

    try {
      await pool.call('add', 1, 2);
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PyProcessError);
    }
  });

  it('should throw on pool size < 1', () => {
    expect(() => createPool({ size: 0 })).toThrow(PyCallNodeError);
  });

  it('isDestroyed should reflect state', async () => {
    const pool = createPool();
    await pool.ready();
    expect(pool.isDestroyed).toBe(false);
    await pool.destroy();
    expect(pool.isDestroyed).toBe(true);
    activePools = activePools.filter((p) => p !== pool);
  });
});
