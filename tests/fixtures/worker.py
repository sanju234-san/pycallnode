"""Test fixture: simple Python functions for integration tests."""
from bridge_runner import expose


@expose
def add(a, b):
    """Simple addition."""
    return a + b


@expose
def greet(name):
    """String operation."""
    return f"Hello, {name}!"


@expose
def echo(value):
    """Return whatever was passed in."""
    return value


@expose
def multiply(a, b):
    """Multiplication."""
    return a * b


@expose
def divide(a, b):
    """Division that can raise ZeroDivisionError."""
    return a / b


@expose
def concat_list(items):
    """Join a list of strings."""
    return ", ".join(str(i) for i in items)


@expose
def get_dict():
    """Return a complex dictionary."""
    return {
        "name": "test",
        "values": [1, 2, 3],
        "nested": {"key": "value"},
    }


@expose
def identity_kwargs(**kwargs):
    """Return kwargs as-is."""
    return kwargs


@expose
def slow_function(seconds):
    """Sleep and return — used for timeout tests."""
    import time
    time.sleep(seconds)
    return f"slept {seconds}s"
