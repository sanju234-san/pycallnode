import time
import json
import os
from typing import List, Dict, Any, Union

# Global model cache
EMBEDDING_MODELS = {}

def get_latency(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 2)

def to_list(data: Any) -> Any:
    """Recursively convert numpy arrays and tensors to lists."""
    if hasattr(data, 'tolist'):
        return data.tolist()
    if isinstance(data, dict):
        return {k: to_list(v) for k, v in data.items()}
    if isinstance(data, (list, tuple)):
        return [to_list(i) for i in data]
    return data

def encode(provider: str, model: str, text: str, **kwargs) -> Dict[str, Any]:
    start = time.perf_counter()
    vectors = encode_batch(provider, model, [text], **kwargs)
    return {
        "vector": vectors["vectors"][0],
        "latencyMs": get_latency(start)
    }

def encode_batch(provider: str, model: str, texts: List[str], **kwargs) -> Dict[str, Any]:
    start = time.perf_counter()
    cache_key = f"{provider}:{model}"
    
    vectors = []
    
    if provider == 'sentence-transformers':
        from sentence_transformers import SentenceTransformer
        if cache_key not in EMBEDDING_MODELS:
            EMBEDDING_MODELS[cache_key] = SentenceTransformer(model)
        model_obj = EMBEDDING_MODELS[cache_key]
        vectors = model_obj.encode(texts).tolist()
        
    elif provider == 'openai':
        from openai import OpenAI
        if cache_key not in EMBEDDING_MODELS:
            EMBEDDING_MODELS[cache_key] = OpenAI(api_key=kwargs.get('api_key') or os.environ.get('OPENAI_API_KEY'))
        client = EMBEDDING_MODELS[cache_key]
        response = client.embeddings.create(input=texts, model=model)
        vectors = [d.embedding for d in response.data]
        
    elif provider == 'huggingface':
        from transformers import pipeline
        if cache_key not in EMBEDDING_MODELS:
            EMBEDDING_MODELS[cache_key] = pipeline('feature-extraction', model=model)
        pipe = EMBEDDING_MODELS[cache_key]
        hidden_states = pipe(texts)
        # Average pooling for sentence embedding
        import numpy as np
        vectors = [np.mean(s[0], axis=0).tolist() for s in hidden_states]
        
    elif provider == 'ollama':
        import ollama
        vectors = [ollama.embeddings(model=model, prompt=t)['embedding'] for t in texts]
        
    elif provider == 'fastembed':
        from fastembed import TextEmbedding
        if cache_key not in EMBEDDING_MODELS:
            EMBEDDING_MODELS[cache_key] = TextEmbedding(model_name=model)
        model_obj = EMBEDDING_MODELS[cache_key]
        vectors = [v.tolist() for v in model_obj.embed(texts)]
        
    elif provider == 'cohere':
        import cohere
        if cache_key not in EMBEDDING_MODELS:
            EMBEDDING_MODELS[cache_key] = cohere.Client(kwargs.get('api_key') or os.environ.get('COHERE_API_KEY'))
        client = EMBEDDING_MODELS[cache_key]
        response = client.embed(texts=texts, model=model, input_type='search_document')
        vectors = to_list(response.embeddings)

    return {
        "vectors": vectors,
        "latencyMs": get_latency(start)
    }

def similarity(provider: str, model: str, textA: str, textB: str, **kwargs) -> Dict[str, Any]:
    start = time.perf_counter()
    res = encode_batch(provider, model, [textA, textB], **kwargs)
    vecs = res["vectors"]
    
    import numpy as np
    vA = np.array(vecs[0])
    vB = np.array(vecs[1])
    
    score = float(np.dot(vA, vB) / (np.linalg.norm(vA) * np.linalg.norm(vB)))
    
    return {
        "score": score,
        "latencyMs": get_latency(start)
    }

def search(provider: str, model: str, query: str, corpus: List[str], topK: int = 5, **kwargs) -> Dict[str, Any]:
    start = time.perf_counter()
    all_texts = [query] + corpus
    res = encode_batch(provider, model, all_texts, **kwargs)
    vecs = res["vectors"]
    
    import numpy as np
    q_vec = np.array(vecs[0])
    c_vecs = np.array(vecs[1:])
    
    # Cosine similarities
    dot_products = np.dot(c_vecs, q_vec)
    norms = np.linalg.norm(c_vecs, axis=1) * np.linalg.norm(q_vec)
    scores = dot_products / norms
    
    # Get topK
    indices = np.argsort(scores)[::-1][:topK]
    results = []
    for idx in indices:
        results.append({
            "text": corpus[idx],
            "score": float(scores[idx]),
            "index": int(idx)
        })
        
    return {
        "results": results,
        "latencyMs": get_latency(start)
    }
