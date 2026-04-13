import time
import json
import base64
import io
import os
import requests
from typing import List, Dict, Any, Union
from PIL import Image

# Global model cache
VISION_MODELS = {}

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

def load_image(image_input: str) -> Image.Image:
    """Loads image from path, b64, or URL."""
    if image_input.startswith(('http://', 'https://')):
        response = requests.get(image_input)
        return Image.open(io.BytesIO(response.content)).convert("RGB")
    elif os.path.isfile(image_input):
        return Image.open(image_input).convert("RGB")
    else:
        # Assume base64
        try:
            if ',' in image_input:
                image_input = image_input.split(',')[1]
            img_data = base64.b64decode(image_input)
            return Image.open(io.BytesIO(img_data)).convert("RGB")
        except:
            raise ValueError("Invalid image input: not a path, URL, or valid base64.")

def detect(framework: str, modelPath: str, image: str, **kwargs) -> Dict[str, Any]:
    start = time.perf_counter()
    cache_key = f"{framework}:{modelPath}"
    
    results_data = {}
    
    if framework == 'yolov8':
        from ultralytics import YOLO
        if cache_key not in VISION_MODELS:
            VISION_MODELS[cache_key] = YOLO(modelPath)
        model = VISION_MODELS[cache_key]
        
        # YOLOv8 supports path/URL directly, but for consistency we use load_image for b64
        results = model.predict(load_image(image) if len(image) > 500 else image, **kwargs)
        detections = []
        for r in results:
            boxes = r.boxes
            for box in boxes:
                b = box.xywh[0].tolist() # x, y, w, h
                detections.append({
                    "class": model.names[int(box.cls)],
                    "confidence": float(box.conf),
                    "bbox": {"x": b[0], "y": b[1], "w": b[2], "h": b[3]}
                })
        results_data = {"detections": detections, "count": len(detections)}
        
    elif framework == 'sam2':
        # Placeholder for SAM2 logic (requires specific segmenting calls)
        results_data = {"message": "SAM2 implementation requires specific prompt points."}

    return {
        **results_data,
        "latencyMs": get_latency(start)
    }

def classify(framework: str, model: str, image: str, **kwargs) -> Dict[str, Any]:
    start = time.perf_counter()
    cache_key = f"classify:{framework}:{model}"
    
    img = load_image(image)
    
    if framework == 'transformers':
        from transformers import pipeline
        if cache_key not in VISION_MODELS:
            VISION_MODELS[cache_key] = pipeline("image-classification", model=model)
        pipe = VISION_MODELS[cache_key]
        results = pipe(img)
        return {
            "label": results[0]['label'],
            "confidence": results[0]['score'],
            "topK": results,
            "latencyMs": get_latency(start)
        }
    
    return {"error": "Framework not supported", "latencyMs": get_latency(start)}

def caption(framework: str, model: str, image: str, **kwargs) -> Dict[str, Any]:
    start = time.perf_counter()
    cache_key = f"caption:{framework}:{model}"
    img = load_image(image)
    
    if framework == 'transformers':
        from transformers import pipeline
        if cache_key not in VISION_MODELS:
            VISION_MODELS[cache_key] = pipeline("image-to-text", model=model)
        pipe = VISION_MODELS[cache_key]
        results = pipe(img)
        return {
            "caption": results[0]['generated_text'],
            "latencyMs": get_latency(start)
        }
    
    return {"error": "Framework not supported", "latencyMs": get_latency(start)}

def analyze_faces(image: str, attributes: List[str] = ['emotion'], **kwargs) -> Dict[str, Any]:
    start = time.perf_counter()
    from deepface import DeepFace
    # DeepFace handles path/b64 directly
    results = DeepFace.analyze(img_path=image, actions=attributes, enforce_detection=False)
    
    return {
        "results": to_list(results),
        "latencyMs": get_latency(start)
    }

def ocr(image: str, languages: List[str] = ['en'], gpu: bool = False, **kwargs) -> Dict[str, Any]:
    start = time.perf_counter()
    import easyocr
    cache_key = f"ocr:{','.join(languages)}:{gpu}"
    
    if cache_key not in VISION_MODELS:
        VISION_MODELS[cache_key] = easyocr.Reader(languages, gpu=gpu)
    reader = VISION_MODELS[cache_key]
    
    # easyocr needs numpy or path
    import numpy as np
    img_np = np.array(load_image(image))
    results = reader.readtext(img_np)
    
    full_text = " ".join([r[1] for r in results])
    blocks = [{"text": r[1], "bbox": to_list(r[0]), "confidence": float(r[2])} for r in results]
    
    return {
        "text": full_text,
        "blocks": blocks,
        "latencyMs": get_latency(start)
    }
