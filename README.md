# pycall-node 🚀

[![npm version](https://img.shields.io/npm/v/pycall-node.svg)](https://www.npmjs.com/package/pycall-node)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen.svg)](https://nodejs.org/)

Call Python ML/AI functions from Node.js as native async functions. Seamlessly bridge the gap between Node.js and Python for heavy-duty inference tasks.

## Install

```bash
npm install pycall-node
```

## Quick Start (sklearn)

```javascript
const { PyBridge } = require('pycall-node');
const py = new PyBridge({ autoInstall: true });

await py.start();
const prediction = await py.inference.predict({
  modelPath: './model.pkl',
  framework: 'sklearn',
  input: [[5.1, 3.5, 1.4, 0.2]]
});
console.log(prediction);
await py.stop();
```

---

## Tier 1 Features

### 1. Core Bridge
Low-latency communication over NDJSON stdin/stdout.
- **Unique Call IDs**: Parallel calls are matched via UUIDs.
- **Auto-Restart**: Process crashes are handled with exponential backoff.
- **Timeouts**: Configurable per-call or global timeouts.

### 2. Model Inference Bridge
Native support for leading ML frameworks (sklearn, torch, tensorflow, yolov8, transformers).

### 3. Streaming Output
Perfect for LLM token streaming. Supports `AsyncIterator` and `EventEmitter`.

---

## Tier 2 Features (GenAI & Vision)

### 4. RAG Pipeline Connector
Bridge Node.js directly into LangChain or LlamaIndex RAG pipelines.

```javascript
// Query a Chroma RAG pipeline
const answer = await py.rag.query({
  backend: 'langchain-chroma',
  vectorstorePath: './chroma_db',
  embeddingModel: 'sentence-transformers/all-MiniLM-L6-v2',
  llm: 'ollama/llama3',
  query: 'What is the attention mechanism?'
});

// Stream RAG answer
const stream = py.rag.stream({
  backend: 'langchain-chroma',
  vectorstorePath: './chroma_db',
  query: 'Summarize the document'
});
for await (const token of stream) {
  process.stdout.write(token);
}
```

### 5. Embedding Generator
Generate vector embeddings from any provider (sentence-transformers, OpenAI, Ollama, FastEmbed).

```javascript
const vector = await py.embeddings.encode({
  provider: 'sentence-transformers',
  model: 'all-MiniLM-L6-v2',
  text: 'Semantic search is powerful'
});

const results = await py.embeddings.search({
  provider: 'fastembed',
  model: 'BAAI/bge-small-en-v1.5',
  query: 'machine learning',
  corpus: ['deep learning', 'cooking pizza', 'neural nets']
});
```

### 6. Vision Model Bridge
Bridge Node.js to Python vision pipelines (YOLOv8, Transformers, OCR, DeepFace).

```javascript
const detections = await py.vision.detect({
  framework: 'yolov8',
  modelPath: './yolov8n.pt',
  image: './scene.jpg'
});

const text = await py.vision.ocr({
  image: './invoice.png',
  languages: ['en']
});
```

---

## Supported Frameworks

| Category | Libraries |
|----------|-----------|
| **Core ML** | `sklearn`, `torch`, `tensorflow`, `onnxruntime`, `xgboost`, `catboost` |
| **GenAI** | `langchain`, `llama-index`, `transformers`, `sentence-transformers`, `fastembed` |
| **Vision** | `ultralytics` (YOLO), `opencv-python`, `pillow`, `deepface`, `easyocr`, `sam2` |
| **Providers** | `openai`, `ollama`, `cohere`, `huggingface_hub` |

## Requirements
- Node.js >= 16.0.0
- Python 3.8+
- pip (for auto-install)

## License
MIT © sanjeevni112
