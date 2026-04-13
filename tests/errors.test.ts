/**
 * Unit tests for the error hierarchy.
 */
import { describe, it, expect } from 'vitest';
import {
  PyCallNodeError,
  PyTimeoutError,
  PyProcessError,
  PyRuntimeError,
} from '../src/errors.js';

describe('Error Hierarchy', () => {
  describe('PyCallNodeError (base)', () => {
    it('is an instance of Error and PyCallNodeError', () => {
      const err = new PyCallNodeError('base error');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(PyCallNodeError);
      expect(err.name).toBe('PyCallNodeError');
      expect(err.message).toBe('base error');
    });

    it('supports cause via ErrorOptions', () => {
      const cause = new Error('root cause');
      const err = new PyCallNodeError('wrapper', { cause });
      expect(err.cause).toBe(cause);
    });
  });

  describe('PyTimeoutError', () => {
    it('extends PyCallNodeError with timeout metadata', () => {
      const err = new PyTimeoutError('compute', 5000);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(PyCallNodeError);
      expect(err).toBeInstanceOf(PyTimeoutError);
      expect(err.name).toBe('PyTimeoutError');
      expect(err.timeoutMs).toBe(5000);
      expect(err.message).toContain('compute');
      expect(err.message).toContain('5000');
    });
  });

  describe('PyProcessError', () => {
    it('extends PyCallNodeError with exit code and stderr', () => {
      const err = new PyProcessError('crashed', 1, 'segfault\n');
      expect(err).toBeInstanceOf(PyCallNodeError);
      expect(err).toBeInstanceOf(PyProcessError);
      expect(err.name).toBe('PyProcessError');
      expect(err.exitCode).toBe(1);
      expect(err.stderr).toBe('segfault\n');
    });

    it('handles null exit code (e.g. killed by signal)', () => {
      const err = new PyProcessError('killed', null, '');
      expect(err.exitCode).toBeNull();
    });
  });

  describe('PyRuntimeError', () => {
    it('extends PyCallNodeError with Python exception details', () => {
      const err = new PyRuntimeError(
        'division by zero',
        'ZeroDivisionError',
        'Traceback (most recent call last):\n  ...',
      );
      expect(err).toBeInstanceOf(PyCallNodeError);
      expect(err).toBeInstanceOf(PyRuntimeError);
      expect(err.name).toBe('PyRuntimeError');
      expect(err.pythonType).toBe('ZeroDivisionError');
      expect(err.pythonTraceback).toContain('Traceback');
    });
  });

  describe('instanceof chains', () => {
    it('all errors are catchable as PyCallNodeError', () => {
      const errors = [
        new PyCallNodeError('a'),
        new PyTimeoutError('fn', 1000),
        new PyProcessError('b', 1, ''),
        new PyRuntimeError('c', 'TypeError', ''),
      ];

      for (const err of errors) {
        expect(err).toBeInstanceOf(PyCallNodeError);
        expect(err).toBeInstanceOf(Error);
      }
    });

    it('specific types are distinguishable', () => {
      const timeout = new PyTimeoutError('fn', 1000);
      expect(timeout).not.toBeInstanceOf(PyProcessError);
      expect(timeout).not.toBeInstanceOf(PyRuntimeError);
    });
  });
});
