const { execSync, spawnSync } = require('child_process');
const path = require('path');

class EnvManager {
  constructor(options = {}) {
    this.pythonPath = options.pythonPath || 'python3';
    this.autoInstall = options.autoInstall || false;
    this.requiredPackages = options.requiredPackages || [];
  }

  /**
   * Detects the best python command available.
   */
  async detectPython() {
    if (this.pythonPath !== 'auto') return this.pythonPath;

    const commands = ['python3', 'python', 'py'];
    for (const cmd of commands) {
      try {
        execSync(`${cmd} --version`, { stdio: 'ignore' });
        this.pythonPath = cmd;
        return cmd;
      } catch (e) {
        continue;
      }
    }
    throw new Error('Could not detect Python installation. Please provide pythonPath.');
  }

  /**
   * Checks and installs missing packages.
   */
  async setup() {
    await this.detectPython();
    if (this.requiredPackages.length === 0) return;

    const result = spawnSync(this.pythonPath, [
      require.resolve('../python/env_check.py'),
      JSON.stringify(this.requiredPackages)
    ]);

    if (result.status !== 0) {
      throw new Error(`Package check failed: ${result.stderr.toString()}`);
    }

    const { missing } = JSON.parse(result.stdout.toString());

    if (missing && missing.length > 0) {
      if (this.autoInstall) {
        console.log(`Installing missing packages: ${missing.join(', ')}...`);
        try {
          execSync(`${this.pythonPath} -m pip install ${missing.join(' ')}`, { stdio: 'inherit' });
        } catch (err) {
          throw new Error(`Failed to install missing packages: ${err.message}`);
        }
      } else {
        const cmd = `${this.pythonPath} -m pip install ${missing.join(' ')}`;
        console.warn('----------------------------------------------------');
        console.warn('MISSING PYTHON PACKAGES DETECTED:');
        missing.forEach(pkg => console.warn(` - ${pkg}`));
        console.warn('\nPlease run the following command to install them:');
        console.warn(`\x1b[36m${cmd}\x1b[0m`);
        console.warn('----------------------------------------------------');
      }
    }
  }
}

module.exports = { EnvManager };
