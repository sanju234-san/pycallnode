"""Test fixture: a script that crashes after being called once."""
import os
from bridge_runner import expose

_call_count = 0

@expose
def crash_after_one():
    """First call works, subsequent calls crash the process."""
    global _call_count
    _call_count += 1
    if _call_count > 1:
        os._exit(1)  # Hard crash
    return "ok"


@expose
def always_crash():
    """Immediately crash."""
    os._exit(1)
