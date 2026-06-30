import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { Bridge } from '../src/bridge.js';

const __dirname_resolved = dirname(fileURLToPath(import.meta.url));
const WORKER = resolve(__dirname_resolved, 'fixtures', 'worker.py');

async function runBenchmark() {
  console.log('\n=== Running Interop Latency Benchmark ===\n');

  // 1. Measure cold spawn overhead
  const spawnStart = performance.now();
  execSync('python -c "print(1 + 2)"');
  const spawnEnd = performance.now();
  const spawnLatency = spawnEnd - spawnStart;
  console.log(`Cold Subprocess Spawning Overhead: ~${spawnLatency.toFixed(2)}ms`);

  // 2. Measure persistent bridge RPC latency
  const bridge = new Bridge({ pythonScript: WORKER, pythonPath: 'python' });
  await bridge.ready();

  // Run a warmup call
  await bridge.call('add', 1, 2);

  // Measure bridge calls over 100 iterations
  const iterations = 100;
  const bridgeStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    await bridge.call('add', 1, 2);
  }
  const bridgeEnd = performance.now();
  const averageBridgeLatency = (bridgeEnd - bridgeStart) / iterations;

  console.log(`Average Bridge RPC Latency: ~${averageBridgeLatency.toFixed(2)}ms`);
  
  const improvement = spawnLatency / averageBridgeLatency;
  console.log(`\nLatency Reduction: ~${improvement.toFixed(0)}x faster!`);

  await bridge.destroy();
  console.log('\n=========================================\n');
}

runBenchmark().catch(console.error);
