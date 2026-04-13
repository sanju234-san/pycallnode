import os
import pickle
import json
import traceback

# Global cache for loaded models
MODELS = {}

def load_or_get_model(model_path, framework):
    """Loads a model or returns it from cache."""
    cache_key = f"{framework}:{model_path}"
    if cache_key in MODELS:
        return MODELS[cache_key]

    model = None
    if framework == 'sklearn':
        with open(model_path, 'rb') as f:
            model = pickle.load(f)
    elif framework == 'torch':
        import torch
        model = torch.load(model_path)
        model.eval()
    elif framework == 'tensorflow' or framework == 'keras':
        import tensorflow as tf
        model = tf.keras.models.load_model(model_path)
    elif framework == 'yolov8':
        from ultralytics import YOLO
        model = YOLO(model_path)
    elif framework == 'transformers':
        # model_path can be a local path or a HF model ID
        from transformers import pipeline
        # Task must be provided in kwargs
        return None # Special handling in call
    elif framework == 'onnx':
        import onnxruntime as ort
        model = ort.InferenceSession(model_path)
    
    if model:
        MODELS[cache_key] = model
    return model

def predict(model_path, framework, input_data, **kwargs):
    """General prediction handler."""
    model = load_or_get_model(model_path, framework)
    
    if framework == 'sklearn':
        return model.predict(input_data).tolist()
    elif framework == 'torch':
        import torch
        with torch.no_grad():
            tensor = torch.tensor(input_data)
            output = model(tensor)
            return output.numpy().tolist()
    elif framework == 'tensorflow' or framework == 'keras':
        return model.predict(input_data).tolist()
    elif framework == 'yolov8':
        results = model(input_data, **kwargs)
        # Convert results to list of dicts for JSON serialization
        return [json.loads(r.tojson()) for r in results]
    elif framework == 'onnx':
        input_name = model.get_inputs()[0].name
        output = model.run(None, {input_name: input_data})
        return [o.tolist() for o in output]
    
    return None

def detect(model_path, framework, image_path, **kwargs):
    """Object detection specific wrapper."""
    if framework == 'yolov8':
        return predict(model_path, framework, image_path, **kwargs)
    # Add other detection frameworks here
    raise ValueError(f"Detection not implemented for {framework}")

def transform(model, task, input_data, **kwargs):
    """HuggingFace transformers pipeline wrapper."""
    cache_key = f"transformers:{model}:{task}"
    if cache_key not in MODELS:
        from transformers import pipeline
        MODELS[cache_key] = pipeline(task, model=model, **kwargs)
    
    pipe = MODELS[cache_key]
    return pipe(input_data)
