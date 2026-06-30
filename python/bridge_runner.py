"""
bridge_runner.py – The Python-side NDJSON bridge for py-callnode.

This module is spawned as a subprocess by the Node.js Bridge class.
It reads JSON requests from stdin (line by line), dispatches them to
@expose'd functions, and writes JSON responses to stdout.

Usage in user scripts:

    from bridge_runner import expose

    @expose
    def add(a, b):
        return a + b

Then on the Node side:
    const bridge = new Bridge({ pythonScript: 'my_script.py' });
    const result = await bridge.call('add', 1, 2);
"""

import sys
import json
import asyncio
import traceback
import importlib
import importlib.util
import os
from typing import Any, Callable, Dict

# ── Registry of exposed functions ────────────────────────────────────────────

_registry: Dict[str, Callable[..., Any]] = {}


def expose(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Decorator that registers a function so it can be called from Node.js."""
    _registry[fn.__name__] = fn
    return fn


# ── NDJSON I/O helpers ───────────────────────────────────────────────────────

def _write_response(response: dict) -> None:
    """Write a single JSON line to stdout and flush immediately."""
    line = json.dumps(response, default=str)
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def _make_error_response(request_id: str, exc: BaseException) -> dict:
    """Build an error response payload from an exception."""
    return {
        "id": request_id,
        "status": "error",
        "error": str(exc),
        "type": type(exc).__name__,
        "traceback": traceback.format_exc(),
    }


# ── Request handling ─────────────────────────────────────────────────────────

def _handle_request_sync(data: dict) -> dict:
    """Dispatch a single request and return a response dict."""
    request_id: str = data.get("id", "unknown")
    fn_name: str = data.get("function", "")
    module_name: str = data.get("module", "")
    args: list = data.get("args", [])
    kwargs: dict = data.get("kwargs", {})

    # If it is a dynamic module call
    if module_name:
        try:
            module = importlib.import_module(module_name)
            fn = getattr(module, fn_name)
            result = fn(*args, **kwargs)

            # Transparently run coroutines via asyncio.run()
            if asyncio.iscoroutine(result):
                result = asyncio.run(result)

            return {
                "id": request_id,
                "status": "ok",
                "result": result,
            }
        except Exception as exc:
            return _make_error_response(request_id, exc)

    if fn_name not in _registry:
        return {
            "id": request_id,
            "status": "error",
            "error": f"Function '{fn_name}' is not exposed",
            "type": "NameError",
            "traceback": "",
        }

    try:
        fn = _registry[fn_name]
        result = fn(*args, **kwargs)

        # Transparently run coroutines via asyncio.run()
        if asyncio.iscoroutine(result):
            result = asyncio.run(result)

        return {
            "id": request_id,
            "status": "ok",
            "result": result,
            "type": "result"
        }
    except Exception as exc:
        return _make_error_response(request_id, exc)


def _handle_stream(request_id: str, module_name: str, fn_name: str, args: list, kwargs: dict) -> None:
    """Consumes a Python generator and writes stream chunks to stdout."""
    try:
        if module_name:
            module = importlib.import_module(module_name)
            func = getattr(module, fn_name)
        else:
            if fn_name not in _registry:
                raise NameError(f"Function '{fn_name}' is not exposed")
            func = _registry[fn_name]

        gen = func(*args, **kwargs)
        for chunk in gen:
            _write_response({
                "id": request_id,
                "type": "chunk",
                "status": "ok",
                "result": chunk
            })
        _write_response({
            "id": request_id,
            "type": "end",
            "status": "ok"
        })
    except Exception as exc:
        _write_response(_make_error_response(request_id, exc))


def _main_loop() -> None:
    """
    Read NDJSON lines from stdin synchronously.

    Synchronous stdin.readline() is fully cross-platform (Windows, Linux,
    macOS) and avoids asyncio pipe issues on Windows Proactor event loop.
    """
    while True:
        try:
            line = sys.stdin.readline()
        except (EOFError, KeyboardInterrupt):
            break

        if not line:
            break  # stdin closed → parent process is gone

        line = line.strip()
        if not line:
            continue

        try:
            data = json.loads(line)
        except json.JSONDecodeError as exc:
            _write_response({
                "id": "unknown",
                "status": "error",
                "error": f"Invalid JSON: {exc}",
                "type": "JSONDecodeError",
                "traceback": "",
            })
            continue

        req_type = data.get("type", "call")
        request_id = data.get("id", "unknown")

        if req_type == "stream":
            module_name = data.get("module", "")
            fn_name = data.get("function", "")
            args = data.get("args", [])
            kwargs = data.get("kwargs", {})
            _handle_stream(request_id, module_name, fn_name, args, kwargs)
        elif req_type == "ping":
            _write_response({
                "id": request_id,
                "status": "ok",
                "result": "pong"
            })
        else:
            response = _handle_request_sync(data)
            _write_response(response)


def _load_user_script(script_path: str) -> None:
    """
    Import the user's Python script so @expose decorators fire.

    CRITICAL: We register this module in sys.modules as 'bridge_runner'
    so that when the user script does `from bridge_runner import expose`,
    it gets the SAME module instance (and therefore the same _registry).
    """
    # Ensure this module is available as 'bridge_runner' in sys.modules
    # regardless of how Python loaded it (__main__ vs direct import).
    this_module = sys.modules[__name__]
    sys.modules['bridge_runner'] = this_module

    abs_path = os.path.abspath(script_path)
    spec = importlib.util.spec_from_file_location("__user_module__", abs_path)
    if spec is None or spec.loader is None:
        _write_response({
            "id": "init",
            "status": "error",
            "error": f"Cannot load script: {abs_path}",
            "type": "ImportError",
            "traceback": "",
        })
        sys.exit(1)

    # Add the script's directory to sys.path so relative imports work
    script_dir = os.path.dirname(abs_path)
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)


# ── Entry point ──────────────────────────────────────────────────────────────

def main() -> None:
    """CLI entry point: python bridge_runner.py <user_script.py>"""
    if len(sys.argv) < 2:
        print("Usage: python bridge_runner.py <script.py>", file=sys.stderr)
        sys.exit(1)

    # Add current working directory to sys.path
    if os.getcwd() not in sys.path:
        sys.path.insert(0, os.getcwd())

    # Add package root to sys.path to resolve 'python.*' runner modules
    script_dir = os.path.dirname(os.path.abspath(__file__))
    package_root = os.path.dirname(script_dir)
    if package_root not in sys.path:
        sys.path.insert(0, package_root)

    user_script = sys.argv[1]
    _load_user_script(user_script)

    # Send a ready signal so Node knows the bridge is up
    _write_response({
        "id": "__ready__",
        "status": "ok",
        "result": list(_registry.keys()),
    })

    try:
        _main_loop()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
