const { spawn } = require('child_process');
const readline = require('readline');
const crypto = require('crypto');
const { PythonError } = require('./errors');
const { InferenceBridge } = require('./inference');
const { RAGConnector } = require('./rag');
const { EmbeddingGenerator } = require('./embeddings');
const { VisionBridge } = require('./vision');
const { PyStream } = require('./streaming');
const { EnvManager } = require('./envmanager');

class PyBridge {
  constructor(options = {}) {
    this.pythonPath = options.pythonPath || 'python3';
    this.defaultTimeout = options.timeout || 30000;
    this.env = options.env || process.env;
    this.autoInstall = options.autoInstall || false;
    this.requiredPackages = options.requiredPackages || [];
    
    this.process = null;
    this.rl = null;
    this.pendingCalls = new Map();
    this.streams = new Map();
    this.isStarting = false;
    this.isStopping = false;
    this.restartAttempts = 0;
    this.maxRestartDelay = 10000;

    this.envManager = new EnvManager({
      pythonPath: this.pythonPath,
      autoInstall: this.autoInstall,
      requiredPackages: this.requiredPackages
    });

    this.inference = new InferenceBridge(this);
  }

  get rag() { return new RAGConnector(this); }
  get embeddings() { return new EmbeddingGenerator(this); }
  get vision() { return new VisionBridge(this); }

  /**
   * Starts the Python child process.
   */
  async start() {
    if (this.process || this.isStarting) return;
    this.isStarting = true;
    this.isStopping = false;

    // Run environment setup (detect python, check packages)
    await this.envManager.setup();
    this.pythonPath = this.envManager.pythonPath; // Update in case of auto-detect

    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(this.pythonPath, [require.resolve('../python/runner.py')], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: this.env
        });

        this.rl = readline.createInterface({
          input: this.process.stdout,
          terminal: false
        });

        this.rl.on('line', (line) => this._handleResponse(line));

        this.process.stderr.on('data', (data) => {
          // Log stderr for debugging, but don't crash
          console.error(`[Python Stderr]: ${data.toString()}`);
        });

        this.process.on('error', (err) => {
          if (this.isStarting) {
            reject(new Error(`Failed to start Python process: ${err.message}`));
            this.isStarting = false;
          }
          this._handleProcessExit(err);
        });

        this.process.on('exit', (code, signal) => {
          this._handleProcessExit(null, code, signal);
        });

        // Simple ping to verify process is ready
        this.ping().then(() => {
          this.isStarting = false;
          this.restartAttempts = 0;
          resolve();
        }).catch(reject);

      } catch (err) {
        this.isStarting = false;
        reject(err);
      }
    });
  }

  /**
   * Stops the Python process.
   */
  async stop() {
    this.isStopping = true;
    if (!this.process) return;

    return new Promise((resolve) => {
      const exitHandler = () => {
        this.process = null;
        resolve();
      };
      
      this.process.once('exit', exitHandler);
      this.process.kill('SIGTERM');
      
      // Fallback if SIGTERM doesn't work
      setTimeout(() => {
        if (this.process) this.process.kill('SIGKILL');
      }, 1000);
    });
  }

  /**
   * Calls a Python function.
   */
  async call(module, func, args = [], kwargs = {}, timeout) {
    if (!this.process) {
      await this.start();
    }

    const callId = crypto.randomUUID();
    const currentTimeout = timeout || this.defaultTimeout;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(callId);
        reject(new Error(`Call to ${module}.${func} timed out after ${currentTimeout}ms`));
      }, currentTimeout);

      this.pendingCalls.set(callId, { resolve, reject, timer });

      this._send({
        type: 'call',
        call_id: callId,
        module,
        func,
        args,
        kwargs
      });
    });
  }

  /**
   * Streams output from a Python generator.
   */
  stream(module, func, args = [], kwargs = {}) {
    if (!this.process && !this.isStarting) {
      throw new Error('Python process not started. Call await py.start() first.');
    }

    const callId = crypto.randomUUID();
    const stream = new PyStream(this, callId);
    this.streams.set(callId, stream);

    this._send({
      type: 'stream',
      call_id: callId,
      module,
      func,
      args,
      kwargs
    });

    return stream;
  }

  /**
   * INTERNAL: Sends a JSON object to the Python stdin.
   */
  _send(data) {
    if (!this.process || !this.process.stdin.writable) {
      throw new Error('Python process is not writable or not started.');
    }
    this.process.stdin.write(JSON.stringify(data) + '\n');
  }

  /**
   * INTERNAL: Handles a line from Python stdout.
   */
  _handleResponse(line) {
    try {
      const response = JSON.parse(line);
      const { call_id, type } = response;

      if (!call_id && type !== 'error') return;

      // Handle stream chunks/end
      if (type === 'chunk' || type === 'end') {
        const stream = this.streams.get(call_id);
        if (stream) {
          if (type === 'chunk') {
            stream.push(response.data);
          } else {
            stream.end();
            this.streams.delete(call_id);
          }
        }
        return;
      }

      const pending = this.pendingCalls.get(call_id);
      if (!pending) {
        // Might be a stream error
        const stream = this.streams.get(call_id);
        if (stream && type === 'error') {
          stream.destroy(new PythonError(response));
          this.streams.delete(call_id);
        }
        return;
      }

      clearTimeout(pending.timer);
      this.pendingCalls.delete(call_id);

      if (type === 'result') {
        pending.resolve(response.data);
      } else if (type === 'error') {
        pending.reject(new PythonError(response));
      } else if (type === 'pong') {
        pending.resolve();
      }
    } catch (err) {
      // Ignore invalid JSON or malformed lines
    }
  }

  /**
   * INTERNAL: Handles process exit and attempts restart.
   */
  _handleProcessExit(err, code, signal) {
    if (this.isStopping) return;

    // Reject all pending calls
    for (const [callId, pending] of this.pendingCalls) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Python process exited unexpectedly'));
    }
    this.pendingCalls.clear();

    const delay = Math.min(Math.pow(2, this.restartAttempts++) * 1000, this.maxRestartDelay);
    console.warn(`Python process exited (code: ${code}, signal: ${signal}). Restarting in ${delay}ms...`);
    
    setTimeout(() => {
      this.start().catch((err) => console.error('Failed to restart Python:', err.message));
    }, delay);
  }

  /**
   * Health check.
   */
  async ping() {
    const callId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(callId);
        reject(new Error('Ping timed out'));
      }, 5000);

      this.pendingCalls.set(callId, { resolve, reject, timer });
      this._send({ type: 'ping', call_id: callId });
    });
  }
}

module.exports = { PyBridge };
