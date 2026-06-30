import { Bridge } from './bridge.js';

export interface VisionDetectOptions {
  framework: string;
  modelPath: string;
  image: string;
  [key: string]: unknown;
}

export interface ClassifyOptions {
  framework: string;
  model: string;
  image: string;
  [key: string]: unknown;
}

export interface CaptionOptions {
  framework: string;
  model: string;
  image: string;
  [key: string]: unknown;
}

export interface AnalyzeFacesOptions {
  image: string;
  attributes?: string[];
  [key: string]: unknown;
}

export interface OCROptions {
  image: string;
  languages?: string[];
  gpu?: boolean;
  [key: string]: unknown;
}

export class VisionBridge {
  private bridge: Bridge;

  constructor(bridge: Bridge) {
    this.bridge = bridge;
  }

  /**
   * Object detection.
   */
  async detect(options: VisionDetectOptions): Promise<unknown> {
    const { framework, modelPath, image, ...kwargs } = options;
    return this.bridge.call(
      'python.vision_runner',
      'detect',
      [framework, modelPath, image],
      kwargs
    );
  }

  /**
   * Image classification.
   */
  async classify(options: ClassifyOptions): Promise<unknown> {
    const { framework, model, image, ...kwargs } = options;
    return this.bridge.call(
      'python.vision_runner',
      'classify',
      [framework, model, image],
      kwargs
    );
  }

  /**
   * Image captioning.
   */
  async caption(options: CaptionOptions): Promise<unknown> {
    const { framework, model, image, ...kwargs } = options;
    return this.bridge.call(
      'python.vision_runner',
      'caption',
      [framework, model, image],
      kwargs
    );
  }

  /**
   * Face analysis.
   */
  async analyzeFaces(options: AnalyzeFacesOptions): Promise<unknown> {
    const { image, attributes = ['emotion'], ...kwargs } = options;
    return this.bridge.call(
      'python.vision_runner',
      'analyze_faces',
      [image, attributes],
      kwargs
    );
  }

  /**
   * OCR - Extract text from image.
   */
  async ocr(options: OCROptions): Promise<unknown> {
    const { image, languages = ['en'], gpu = false, ...kwargs } = options;
    return this.bridge.call(
      'python.vision_runner',
      'ocr',
      [image, languages, gpu],
      kwargs
    );
  }
}
