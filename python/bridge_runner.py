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
    args: list = data.get("args", [])
    kwargs: dict = data.get("kwargs", {})

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
        }
    except Exception as exc:
        return _make_error_response(request_id, exc)


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
