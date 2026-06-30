import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname_resolved =
  typeof __dirname !== 'undefined'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));

const ENV_CHECK_PATH = resolve(
  __dirname_resolved,
  '..',
  'python',
  'env_check.py',
);

export interface EnvManagerOptions {
  pythonPath?: string;
  autoInstall?: boolean;
  requiredPackages?: string[];
}

export class EnvManager {
  public pythonPath: string;
  private autoInstall: boolean;
  private requiredPackages: string[];

  constructor(options: EnvManagerOptions = {}) {
    this.pythonPath = options.pythonPath || 'python3';
    this.autoInstall = options.autoInstall || false;
    this.requiredPackages = options.requiredPackages || [];
  }

  /**
   * Detects the best python command available.
   */
  async detectPython(): Promise<string> {
    if (this.pythonPath !== 'auto') return this.pythonPath;

    const commands = ['python3', 'python', 'py'];
    for (const cmd of commands) {
      try {
        execSync(`${cmd} --version`, { stdio: 'ignore' });
        this.pythonPath = cmd;
        return cmd;
      } catch {
        continue;
      }
    }
    throw new Error('Could not detect Python installation. Please provide pythonPath.');
  }

  /**
   * Checks and installs missing packages.
   */
  async setup(): Promise<void> {
    await this.detectPython();
    if (this.requiredPackages.length === 0) return;

    const result = spawnSync(this.pythonPath, [
      ENV_CHECK_PATH,
      JSON.stringify(this.requiredPackages)
    ]);

    if (result.status !== 0) {
      throw new Error(`Package check failed: ${result.stderr?.toString() || 'Unknown error'}`);
    }

    const { missing } = JSON.parse(result.stdout.toString());

    if (missing && missing.length > 0) {
      if (this.autoInstall) {
        console.log(`Installing missing packages: ${missing.join(', ')}...`);
        try {
          execSync(`${this.pythonPath} -m pip install ${missing.join(' ')}`, { stdio: 'inherit' });
        } catch (err: any) {
          throw new Error(`Failed to install missing packages: ${err.message}`);
        }
      } else {
        const cmd = `${this.pythonPath} -m pip install ${missing.join(' ')}`;
        console.warn('----------------------------------------------------');
        console.warn('MISSING PYTHON PACKAGES DETECTED:');
        missing.forEach((pkg: string) => console.warn(` - ${pkg}`));
        console.warn('\nPlease run the following command to install them:');
        console.warn(`\x1b[36m${cmd}\x1b[0m`);
        console.warn('----------------------------------------------------');
      }
    }
  }
}
