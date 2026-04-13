class EmbeddingGenerator {
  constructor(bridge) {
    this.bridge = bridge;
  }

  /**
   * Generates embedding for a single text.
   */
  async encode(options) {
    const { provider, model, text, ...kwargs } = options;
    return this.bridge.call(
      'python.embeddings_runner',
      'encode',
      [provider, model, text],
      kwargs
    );
  }

  /**
   * Generates embeddings for a batch of texts.
   */
  async encodeBatch(options) {
    const { provider, model, texts, ...kwargs } = options;
    return this.bridge.call(
      'python.embeddings_runner',
      'encode_batch',
      [provider, model, texts],
      kwargs
    );
  }

  /**
   * Calculates cosine similarity between two texts.
   */
  async similarity(options) {
    const { provider, model, textA, textB, ...kwargs } = options;
    return this.bridge.call(
      'python.embeddings_runner',
      'similarity',
      [provider, model, textA, textB],
      kwargs
    );
  }

  /**
   * Performs semantic search over a corpus.
   */
  async search(options) {
    const { provider, model, query, corpus, topK = 5, ...kwargs } = options;
    return this.bridge.call(
      'python.embeddings_runner',
      'search',
      [provider, model, query, corpus, topK],
      kwargs
    );
  }
}

module.exports = { EmbeddingGenerator };
