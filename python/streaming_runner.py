import sys
import json
import importlib
import traceback

def send_chunk(call_id, data):
    """Sends a stream chunk."""
    sys.stdout.write(json.dumps({
        "type": "chunk",
        "call_id": call_id,
        "data": data
    }) + "\n")
    sys.stdout.flush()

def send_end(call_id):
    """Sends stream end signal."""
    sys.stdout.write(json.dumps({
        "type": "end",
        "call_id": call_id
    }) + "\n")
    sys.stdout.flush()

def handle_stream(call_id, module_name, func_name, args, kwargs):
    """Calls a generator and streams output."""
    try:
        module = importlib.import_module(module_name)
        func = getattr(module, func_name)
        
        gen = func(*args, **kwargs)
        
        for chunk in gen:
            send_chunk(call_id, chunk)
            
        send_end(call_id)
        
    except Exception as e:
        sys.stdout.write(json.dumps({
            "type": "error",
            "call_id": call_id,
            "error": str(e),
            "traceback": traceback.format_exc(),
            "error_type": type(e).__name__
        }) + "\n")
        sys.stdout.flush()
