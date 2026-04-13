class InferenceBridge {
  constructor(bridge) {
    this.bridge = bridge;
  }

  /**
   * Generic prediction.
   */
  async predict(options) {
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
  async detect(options) {
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
  async transform(options) {
    const { model, task, input, ...kwargs } = options;
    return this.bridge.call(
      'python.inference_runner',
      'transform',
      [model, task, input],
      kwargs
    );
  }
}

module.exports = { InferenceBridge };
