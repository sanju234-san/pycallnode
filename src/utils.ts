/**
 * Utility helpers for pycall-node.
 */

/**
 * Normalizes Python paths for different OS.
 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}
