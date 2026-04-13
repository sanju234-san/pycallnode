class RAGConnector {
  constructor(bridge) {
    this.bridge = bridge;
  }

  /**
   * Queries a RAG pipeline.
   */
  async query(options) {
    const { backend, query, ...kwargs } = options;
    return this.bridge.call(
      'python.rag_runner',
      'query',
      [backend, query],
      kwargs
    );
  }

  /**
   * Ingests documents into a vectorstore.
   */
  async ingest(options) {
    const { backend, documentsPath, vectorstorePath, ...kwargs } = options;
    return this.bridge.call(
      'python.rag_runner',
      'ingest',
      [backend, documentsPath, vectorstorePath],
      kwargs
    );
  }

  /**
   * Streams RAG answer token by token.
   */
  stream(options) {
    const { backend, query, ...kwargs } = options;
    return this.bridge.stream(
      'python.rag_runner',
      'stream_query',
      [backend, query],
      kwargs
    );
  }
}

module.exports = { RAGConnector };
