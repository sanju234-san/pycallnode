"""
Crasher worker — crashes after N calls to test exponential backoff auto-restart.
"""
import os
from bridge_runner import expose

_call_count = 0

@expose
def crash_after_one():
    """First call works, second call hard-crashes the process."""
    global _call_count
    _call_count += 1
    if _call_count > 1:
        os._exit(1)  # Hard crash — no cleanup
    return "ok"

@expose
def always_ok():
    """Always succeeds — used after restart to prove recovery."""
    return "recovered"
