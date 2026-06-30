import time
import json
import os
import glob
from typing import List, Dict, Any, Union, Generator

# Global cache for index/vectorstore connections
RAG_STORES = {}

def get_latency(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 2)

def to_list(data: Any) -> Any:
    if hasattr(data, 'tolist'):
        return data.tolist()
    if isinstance(data, dict):
        return {k: to_list(v) for k, v in data.items()}
    if isinstance(data, (list, tuple)):
        return [to_list(i) for i in data]
    return data

def get_embeddings(model_name: str):
    from langchain_community.embeddings import HuggingFaceEmbeddings
    return HuggingFaceEmbeddings(model_name=model_name)

def query(backend: str, query: str, **kwargs) -> Dict[str, Any]:
    start = time.perf_counter()
    
    if backend == 'langchain-chroma':
        from langchain_community.vectorstores import Chroma
        from langchain.chains import RetrievalQA
        # LLM import based on provider
        llm = _get_langchain_llm(kwargs.get('llm'))
        
        cache_key = f"chroma:{kwargs.get('vectorstorePath')}"
        if cache_key not in RAG_STORES:
            embeddings = get_embeddings(kwargs.get('embeddingModel', 'sentence-transformers/all-MiniLM-L6-v2'))
            RAG_STORES[cache_key] = Chroma(persist_directory=kwargs.get('vectorstorePath'), embedding_function=embeddings)
        
        vectorstore = RAG_STORES[cache_key]
        qa = RetrievalQA.from_chain_type(llm=llm, chain_type="stuff", retriever=vectorstore.as_retriever(search_kwargs={"k": kwargs.get('topK', 5)}), return_source_documents=True)
        
        res = qa.invoke({"query": query})
        
        sources = [{"content": doc.page_content, "metadata": doc.metadata} for doc in res["source_documents"]]
        return {
            "answer": res["result"],
            "sources": sources,
            "latencyMs": get_latency(start)
        }

    elif backend == 'llamaindex':
        from llama_index.core import StorageContext, load_index_from_storage
        cache_key = f"llamaindex:{kwargs.get('indexPath')}"
        if cache_key not in RAG_STORES:
            storage_context = StorageContext.from_defaults(persist_dir=kwargs.get('indexPath'))
            RAG_STORES[cache_key] = load_index_from_storage(storage_context)
        
        index = RAG_STORES[cache_key]
        query_engine = index.as_query_engine()
        response = query_engine.query(query)
        
        return {
            "answer": str(response),
            "sources": [{"content": n.node.get_content(), "metadata": n.node.metadata} for n in response.source_nodes],
            "latencyMs": get_latency(start)
        }

    return {"error": "Backend not supported", "latencyMs": get_latency(start)}

def ingest(backend: str, documentsPath: str, vectorstorePath: str, **kwargs) -> Dict[str, Any]:
    start = time.perf_counter()
    from langchain.text_splitter import RecursiveCharacterTextSplitter
    from langchain_community.document_loaders import DirectoryLoader, PyPDFLoader, TextLoader, UnstructuredMarkdownLoader
    
    # Load documents
    # DirectoryLoader with glob for different types
    loaders = {
        '.pdf': PyPDFLoader,
        '.txt': TextLoader,
        '.md': UnstructuredMarkdownLoader
    }
    
    docs = []
    for ext, loader_cls in loaders.items():
        files = glob.glob(os.path.join(documentsPath, f"*{ext}"))
        for f in files:
            loader = loader_cls(f)
            docs.extend(loader.load())
            
    # Split
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=kwargs.get('chunkSize', 512),
        chunk_overlap=kwargs.get('chunkOverlap', 50)
    )
    splits = text_splitter.split_documents(docs)
    
    if backend == 'langchain-chroma':
        from langchain_community.vectorstores import Chroma
        embeddings = get_embeddings(kwargs.get('embeddingModel', 'sentence-transformers/all-MiniLM-L6-v2'))
        vectorstore = Chroma.from_documents(documents=splits, embedding=embeddings, persist_directory=vectorstorePath)
        vectorstore.persist()
        
    return {
        "status": "success",
        "chunksIngested": len(splits),
        "latencyMs": get_latency(start)
    }

def stream_query(backend: str, query: str, **kwargs) -> Generator[str, None, None]:
    """Generator for streaming RAG answers."""
    if backend == 'llamaindex':
        from llama_index.core import StorageContext, load_index_from_storage
        cache_key = f"llamaindex:{kwargs.get('indexPath')}"
        if cache_key not in RAG_STORES:
            storage_context = StorageContext.from_defaults(persist_dir=kwargs.get('indexPath'))
            RAG_STORES[cache_key] = load_index_from_storage(storage_context)
        
        index = RAG_STORES[cache_key]
        query_engine = index.as_query_engine(streaming=True)
        response = query_engine.query(query)
        for token in response.response_gen:
            yield token
    else:
        # LangChain or default
        llm = _get_langchain_llm(kwargs.get('llm'), streaming=True)
        response = llm.stream(query)
        for chunk in response:
            yield chunk.content if hasattr(chunk, 'content') else str(chunk)


def _get_langchain_llm(llm_name_str: str, streaming: bool = False):
    """Helper to route LLM names to LangChain classes."""
    if not llm_name_str:
        from langchain_openai import OpenAI
        return OpenAI(streaming=streaming)
        
    parts = llm_name_str.split('/')
    if parts[0] == 'ollama':
        from langchain_community.llms import Ollama
        return Ollama(model=parts[1])
    elif parts[0] == 'openai':
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model_name=parts[1], streaming=streaming)
    else:
        from langchain_community.llms import HuggingFaceHub
        return HuggingFaceHub(repo_id=llm_name_str)
