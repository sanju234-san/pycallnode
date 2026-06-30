import { Bridge } from './bridge.js';

export interface PredictOptions {
  modelPath: string;
  framework: string;
  input: unknown;
  [key: string]: unknown;
}

export interface DetectOptions {
  modelPath: string;
  framework: string;
  imagePath: string;
  [key: string]: unknown;
}

export interface TransformOptions {
  model: string;
  task: string;
  input: unknown;
  [key: string]: unknown;
}

export class InferenceBridge {
  private bridge: Bridge;

  constructor(bridge: Bridge) {
    this.bridge = bridge;
  }

  /**
   * Generic prediction.
   */
  async predict(options: PredictOptions): Promise<unknown> {
    const { modelPath, framework, input, ...kwargs } = options;
    return this.bridge.call(
      'python.inference_runner',
      'predict',
      [modelPath, framework, input],
      kwargs
    );
  }

  /**
   * Object detection.
   */
  async detect(options: DetectOptions): Promise<unknown> {
    const { modelPath, framework, imagePath, ...kwargs } = options;
    return this.bridge.call(
      'python.inference_runner',
      'detect',
      [modelPath, framework, imagePath],
      kwargs
    );
  }

  /**
   * HuggingFace Transformers.
   */
  async transform(options: TransformOptions): Promise<unknown> {
    const { model, task, input, ...kwargs } = options;
    return this.bridge.call(
      'python.inference_runner',
      'transform',
      [model, task, input],
      kwargs
    );
  }
}
