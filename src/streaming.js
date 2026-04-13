const EventEmitter = require('events');

class PyStream extends EventEmitter {
  constructor(bridge, callId) {
    super();
    this.bridge = bridge;
    this.callId = callId;
    this.queue = [];
    this.resolver = null;
    this.finished = false;
    this.error = null;
  }

  /**
   * Pushes a chunk to the stream.
   */
  push(data) {
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
  end() {
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
  destroy(err) {
    this.error = err;
    this.emit('error', err);
    if (this.resolver) {
      this.resolver(Promise.reject(err));
      this.resolver = null;
    }
  }

  /**
   * Implements AsyncIterator interface.
   */
  async *[Symbol.asyncIterator]() {
    while (!this.finished || this.queue.length > 0) {
      if (this.queue.length > 0) {
        yield this.queue.shift();
      } else if (this.finished) {
        return;
      } else {
        const nextResult = await new Promise((resolve) => {
          this.resolver = resolve;
        });
        if (nextResult.done) return;
        yield nextResult.value;
      }
    }
  }
}

module.exports = { PyStream };
