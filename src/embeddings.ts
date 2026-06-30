import { Bridge } from './bridge.js';

export interface EncodeOptions {
  provider: string;
  model: string;
  text: string;
  [key: string]: unknown;
}

export interface EncodeBatchOptions {
  provider: string;
  model: string;
  texts: string[];
  [key: string]: unknown;
}

export interface SimilarityOptions {
  provider: string;
  model: string;
  textA: string;
  textB: string;
  [key: string]: unknown;
}

export interface SearchOptions {
  provider: string;
  model: string;
  query: string;
  corpus: string[];
  topK?: number;
  [key: string]: unknown;
}

export class EmbeddingGenerator {
  private bridge: Bridge;

  constructor(bridge: Bridge) {
    this.bridge = bridge;
  }

  /**
   * Generates embedding for a single text.
   */
  async encode(options: EncodeOptions): Promise<unknown> {
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
  async encodeBatch(options: EncodeBatchOptions): Promise<unknown> {
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
  async similarity(options: SimilarityOptions): Promise<unknown> {
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
  async search(options: SearchOptions): Promise<unknown> {
    const { provider, model, query, corpus, topK = 5, ...kwargs } = options;
    return this.bridge.call(
      'python.embeddings_runner',
      'search',
      [provider, model, query, corpus, topK],
      kwargs
    );
  }
}
