/**
 * Integration tests for Bridge – tests the full Node ↔ Python round-trip.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { Bridge } from '../src/bridge.js';
import {
  PyRuntimeError,
  PyTimeoutError,
  PyProcessError,
} from '../src/errors.js';

const FIXTURES = resolve(__dirname, 'fixtures');
const WORKER = resolve(FIXTURES, 'worker.py');
const ASYNC_WORKER = resolve(FIXTURES, 'async_worker.py');
const CRASHER = resolve(FIXTURES, 'crasher.py');

// Track bridges for cleanup
let activeBridges: Bridge[] = [];

function createBridge(opts: Partial<Parameters<typeof Bridge['prototype']['constructor']>[0]> & { pythonScript: string }) {
  const b = new Bridge({ pythonPath: 'python', ...opts });
  activeBridges.push(b);
  return b;
}

afterEach(async () => {
  await Promise.all(activeBridges.map((b) => b.destroy()));
  activeBridges = [];
});

describe('Bridge – basic calls', () => {
  it('should ready() and report exposed functions', async () => {
    const bridge = createBridge({ pythonScript: WORKER });
    await bridge.ready();
    expect(bridge.exposedFunctions).toContain('add');
    expect(bridge.exposedFunctions).toContain('greet');
    expect(bridge.exposedFunctions.length).toBeGreaterThan(0);
  });

  it('should add two numbers', async () => {
    const bridge = createBridge({ pythonScript: WORKER });
    await bridge.ready();
    const result = await bridge.call('add', 3, 4);
    expect(result).toBe(7);
  });

  it('should greet by name', async () => {
    const bridge = createBridge({ pythonScript: WORKER });
    await bridge.ready();
    const result = await bridge.call('greet', 'World');
    expect(result).toBe('Hello, World!');
  });

  it('should echo various data types', async () => {
    const bridge = createBridge({ pythonScript: WORKER });
    await bridge.ready();

    expect(await bridge.call('echo', 42)).toBe(42);
    expect(await bridge.call('echo', 'hello')).toBe('hello');
    expect(await bridge.call('echo', null)).toBeNull();
    expect(await bridge.call('echo', true)).toBe(true);
    expect(await bridge.call('echo', [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('should return complex objects', async () => {
    const bridge = createBridge({ pythonScript: WORKER });
    await bridge.ready();
    const result = await bridge.call('get_dict');
    expect(result).toEqual({
      name: 'test',
      values: [1, 2, 3],
      nested: { key: 'value' },
    });
  });

  it('should handle list arguments', async () => {
    const bridge = createBridge({ pythonScript: WORKER });
    await bridge.ready();
    const result = await bridge.call('concat_list', ['a', 'b', 'c']);
    expect(result).toBe('a, b, c');
  });
});

describe('Bridge – async Python functions', () => {
  it('should call async Python functions', async () => {
    const bridge = createBridge({ pythonScript: ASYNC_WORKER });
    await bridge.ready();
    const result = await bridge.call('async_add', 10, 20);
    expect(result).toBe(30);
  });

  it('should call async greet', async () => {
    const bridge = createBridge({ pythonScript: ASYNC_WORKER });
    await bridge.ready();
    const result = await bridge.call('async_greet', 'Vitest');
    expect(result).toBe('Async hello, Vitest!');
  });
});

describe('Bridge – error handling', () => {
  it('should throw PyRuntimeError on Python exception', async () => {
    const bridge = createBridge({ pythonScript: WORKER });
    await bridge.ready();

    try {
      await bridge.call('divide', 1, 0);
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PyRuntimeError);
      const pyErr = err as PyRuntimeError;
      expect(pyErr.pythonType).toBe('ZeroDivisionError');
      expect(pyErr.message).toContain('division by zero');
    }
  });

  it('should throw PyRuntimeError for unknown function', async () => {
    const bridge = createBridge({ pythonScript: WORKER });
    await bridge.ready();

    try {
      await bridge.call('nonexistent_function');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PyRuntimeError);
      const pyErr = err as PyRuntimeError;
      expect(pyErr.message).toContain('nonexistent_function');
    }
  });
});

describe('Bridge – timeouts', () => {
  it('should throw PyTimeoutError when call exceeds timeout', async () => {
    const bridge = createBridge({ pythonScript: WORKER, timeout: 500 });
    await bridge.ready();

    try {
      await bridge.call('slow_function', 10);
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PyTimeoutError);
      const pyErr = err as PyTimeoutError;
      expect(pyErr.timeoutMs).toBe(500);
    }
  });

  it('should support per-call timeout override', async () => {
    const bridge = createBridge({ pythonScript: WORKER, timeout: 30_000 });
    await bridge.ready();

    try {
      await bridge.call('slow_function', [10], { timeout: 300 });
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PyTimeoutError);
    }
  });

  it('should NOT timeout for fast calls', async () => {
    const bridge = createBridge({ pythonScript: WORKER, timeout: 5000 });
    await bridge.ready();
    const result = await bridge.call('add', 1, 2);
    expect(result).toBe(3);
  });
});

describe('Bridge – concurrent calls', () => {
  it('should handle multiple simultaneous calls', async () => {
    const bridge = createBridge({ pythonScript: WORKER });
    await bridge.ready();

    const promises = [
      bridge.call('add', 1, 2),
      bridge.call('add', 3, 4),
      bridge.call('greet', 'Alice'),
      bridge.call('multiply', 5, 6),
      bridge.call('echo', 'test'),
    ];

    const results = await Promise.all(promises);
    expect(results).toEqual([3, 7, 'Hello, Alice!', 30, 'test']);
  });
});

describe('Bridge – kwargs', () => {
  it('should pass keyword arguments via callWithKwargs', async () => {
    const bridge = createBridge({ pythonScript: WORKER });
    await bridge.ready();
    const result = await bridge.callWithKwargs(
      'identity_kwargs',
      [],
      { name: 'test', value: 42 },
    );
    expect(result).toEqual({ name: 'test', value: 42 });
  });
});

describe('Bridge – lifecycle', () => {
  it('should reject calls after destroy()', async () => {
    const bridge = createBridge({ pythonScript: WORKER });
    await bridge.ready();
    await bridge.destroy();
    activeBridges = activeBridges.filter((b) => b !== bridge);

    try {
      await bridge.call('add', 1, 2);
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PyProcessError);
    }
  });

  it('should be idempotent on double destroy()', async () => {
    const bridge = createBridge({ pythonScript: WORKER });
    await bridge.ready();
    await bridge.destroy();
    await bridge.destroy(); // should not throw
    activeBridges = activeBridges.filter((b) => b !== bridge);
  });

  it('should report isDestroyed correctly', async () => {
    const bridge = createBridge({ pythonScript: WORKER });
    await bridge.ready();
    expect(bridge.isDestroyed).toBe(false);
    await bridge.destroy();
    expect(bridge.isDestroyed).toBe(true);
    activeBridges = activeBridges.filter((b) => b !== bridge);
  });
});

describe('Bridge – auto-restart', () => {
  it('should auto-restart after a crash and continue working', async () => {
    const bridge = createBridge({
      pythonScript: CRASHER,
      maxRestarts: 3,
    });
    await bridge.ready();

    // First call on fresh process should succeed
    const r1 = await bridge.call('crash_after_one');
    expect(r1).toBe('ok');

    // Second call will crash the process, bridge should auto-restart
    // After restart, crash_after_one's counter resets, so next call works
    // We need to wait a moment for the restart
    try {
      await bridge.call('crash_after_one');
    } catch {
      // The crash may cause this call to fail
    }

    // Give it time to restart
    await new Promise((r) => setTimeout(r, 1500));
    await bridge.ready();

    // After restart, should work again
    const r3 = await bridge.call('crash_after_one');
    expect(r3).toBe('ok');
  });

  it('should emit restart events', async () => {
    const restartCounts: number[] = [];
    const bridge = createBridge({
      pythonScript: CRASHER,
      maxRestarts: 2,
    });
    bridge.on('restart', (count: number) => restartCounts.push(count));
    await bridge.ready();

    // Trigger a crash
    try {
      await bridge.call('crash_after_one');
      await bridge.call('crash_after_one');
    } catch {
      // expected
    }

    await new Promise((r) => setTimeout(r, 1500));
    expect(restartCounts.length).toBeGreaterThanOrEqual(1);
  });
});
