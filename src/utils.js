/**
 * Utility helpers for pycall-node.
 */

/**
 * Normalizes Python paths for different OS.
 */
function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

module.exports = {
  normalizePath
};
