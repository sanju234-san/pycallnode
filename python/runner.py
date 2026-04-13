import sys
import json
import importlib
import traceback
import signal
import os

def send_json(data):
    """Sends a JSON line to stdout."""
    sys.stdout.write(json.dumps(data) + "\n")
    sys.stdout.flush()

def handle_call(call_id, module_name, func_name, args, kwargs):
    """Dynamically imports and calls a function."""
    try:
        module = importlib.import_module(module_name)
        func = getattr(module, func_name)
        
        result = func(*args, **kwargs)
        
        send_json({
            "type": "result",
            "call_id": call_id,
            "data": result
        })
    except Exception as e:
        send_json({
            "type": "error",
            "call_id": call_id,
            "error": str(e),
            "traceback": traceback.format_exc(),
            "error_type": type(e).__name__
        })

def main():
    """Main loop for reading NDJSON from stdin."""
    # Add current directory to sys.path
    if os.getcwd() not in sys.path:
        sys.path.insert(0, os.getcwd())

    # Add package root (parent of python/ directory) to sys.path
    # This allows 'import python.inference_runner' to work
    script_dir = os.path.dirname(os.path.abspath(__file__))
    package_root = os.path.dirname(script_dir)
    if package_root not in sys.path:
        sys.path.insert(0, package_root)

    # Signal handling for clean exit
    def signal_handler(sig, frame):
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    for line in sys.stdin:
        if not line.strip():
            continue
            
        try:
            req = json.loads(line)
            req_type = req.get("type")
            call_id = req.get("call_id")
            
            if req_type == "call":
                handle_call(
                    call_id,
                    req.get("module"),
                    req.get("func"),
                    req.get("args", []),
                    req.get("kwargs", {})
                )
            elif req_type == "stream":
                import streaming_runner
                streaming_runner.handle_stream(
                    call_id,
                    req.get("module"),
                    req.get("func"),
                    req.get("args", []),
                    req.get("kwargs", {})
                )
            elif req_type == "ping":
                send_json({"type": "pong", "call_id": call_id})
            
        except json.JSONDecodeError:
            continue
        except Exception as e:
            # Global catch-all to prevent runner from crashing
            send_json({
                "type": "error",
                "call_id": None,
                "error": f"Critical runner error: {str(e)}",
                "traceback": traceback.format_exc()
            })

if __name__ == "__main__":
    main()
