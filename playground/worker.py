"""
Playground worker — exposes various functions to validate resume claims.
"""
from bridge_runner import expose
import time
import os
import math

# ── Claim 1 & 3: Persistent NDJSON bridge + async/await ──────────────────────

@expose
def add(a, b):
    """Simple addition — proves NDJSON round-trip works."""
    return a + b

@expose
def greet(name):
    """String operation — proves argument serialization."""
    return f"Hello, {name}!"

@expose
def multiply(a, b):
    return a * b

@expose
def echo(value):
    """Return whatever was passed in — proves type fidelity."""
    return value

@expose
def get_complex():
    """Returns a nested dict — proves complex JSON serialization."""
    return {
        "name": "pycall-node",
        "version": "1.1.0",
        "features": ["bridge", "pool", "streaming", "inference"],
        "nested": {"deep": {"value": 42}},
        "array_of_objects": [
            {"id": 1, "label": "sklearn"},
            {"id": 2, "label": "pytorch"},
            {"id": 3, "label": "tensorflow"},
        ]
    }

# ── Claim 2: Latency benchmark helper ────────────────────────────────────────

@expose
def noop():
    """Does nothing — pure round-trip latency measurement."""
    return True

@expose
def timestamp():
    """Returns high-precision timestamp from Python side."""
    return time.perf_counter()

# ── Claim 3: Python ML functions as async/await ──────────────────────────────

@expose
def compute_statistics(data):
    """Simulates an ML-style computation (mean, std, min, max)."""
    n = len(data)
    mean = sum(data) / n
    variance = sum((x - mean) ** 2 for x in data) / n
    std = math.sqrt(variance)
    return {
        "mean": round(mean, 4),
        "std": round(std, 4),
        "min": min(data),
        "max": max(data),
        "count": n
    }

@expose
def predict_linear(weights, bias, features):
    """Simulates a linear model prediction: y = Wx + b."""
    result = sum(w * x for w, x in zip(weights, features)) + bias
    return {"prediction": round(result, 6), "model": "linear_regression"}

@expose
def classify(features, threshold=0.5):
    """Simulates a binary classifier."""
    score = sum(features) / len(features)
    return {
        "score": round(score, 4),
        "label": "positive" if score >= threshold else "negative",
        "confidence": round(abs(score - threshold) + 0.5, 4)
    }

# ── Claim 5: Streaming support ───────────────────────────────────────────────

@expose
def stream_tokens(text):
    """Generator that yields tokens one at a time — simulates LLM streaming."""
    tokens = text.split()
    for token in tokens:
        time.sleep(0.05)  # Simulate token generation delay
        yield token

@expose
def stream_numbers(start, end):
    """Generator that yields numbers — simulates streaming computation."""
    for i in range(start, end + 1):
        yield i

# ── Claim 6: Error generation for typed error hierarchy ──────────────────────

@expose
def divide(a, b):
    """Will raise ZeroDivisionError when b=0."""
    return a / b

@expose
def raise_custom(message):
    """Raises a ValueError with the given message."""
    raise ValueError(message)

@expose
def raise_type_error():
    """Raises a TypeError."""
    return 1 + "string"

# ── Claim 7: Slow function for timeout testing ──────────────────────────────

@expose
def slow_function(seconds):
    """Sleeps for N seconds — used for timeout testing."""
    time.sleep(seconds)
    return f"slept {seconds}s"

# ── Claim 8: Kwargs support ─────────────────────────────────────────────────

@expose
def identity_kwargs(**kwargs):
    """Return kwargs as-is."""
    return kwargs

@expose
def train_model(model_type="linear", epochs=10, lr=0.01, verbose=False):
    """Simulates training a model with keyword arguments."""
    return {
        "model_type": model_type,
        "epochs": epochs,
        "learning_rate": lr,
        "status": "trained",
        "final_loss": round(1.0 / (epochs * lr + 1), 6)
    }
