import { Bridge } from './bridge.js';
import { PyStream } from './streaming.js';

export interface QueryOptions {
  backend: string;
  query: string;
  [key: string]: unknown;
}

export interface IngestOptions {
  backend: string;
  documentsPath: string;
  vectorstorePath: string;
  [key: string]: unknown;
}

export class RAGConnector {
  private bridge: Bridge;

  constructor(bridge: Bridge) {
    this.bridge = bridge;
  }

  /**
   * Queries a RAG pipeline.
   */
  async query(options: QueryOptions): Promise<unknown> {
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
  async ingest(options: IngestOptions): Promise<unknown> {
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
  stream(options: QueryOptions): PyStream {
    const { backend, query, ...kwargs } = options;
    return this.bridge.stream(
      'python.rag_runner',
      'stream_query',
      [backend, query],
      kwargs
    );
  }
}
