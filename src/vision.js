class VisionBridge {
  constructor(bridge) {
    this.bridge = bridge;
  }

  /**
   * Object detection.
   */
  async detect(options) {
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
  async classify(options) {
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
  async caption(options) {
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
  async analyzeFaces(options) {
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
  async ocr(options) {
    const { image, languages = ['en'], gpu = false, ...kwargs } = options;
    return this.bridge.call(
      'python.vision_runner',
      'ocr',
      [image, languages, gpu],
      kwargs
    );
  }
}

module.exports = { VisionBridge };
