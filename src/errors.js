/**
 * Custom Error class for Python-related failures.
 * Surfaces structured traceback information.
 */
class PythonError extends Error {
  constructor(data) {
    super(data.error || 'Unknown Python Error');
    this.name = 'PythonError';
    this.type = data.error_type || 'Exception';
    this.pythonTraceback = data.traceback;
    
    // Parse traceback for file and line number
    const tracebackLines = (data.traceback || '').split('\n');
    for (let i = tracebackLines.length - 1; i >= 0; i--) {
      const line = tracebackLines[i];
      const match = line.match(/File "([^"]+)", line (\d+)/);
      if (match) {
        this.pythonFile = match[1];
        this.pythonLine = parseInt(match[2], 10);
        break;
      }
    }
    
    // Maintain proper stack trace for where the error was thrown in JS
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = {
  PythonError
};
