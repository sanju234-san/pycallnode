"""Test fixture: async functions."""
import asyncio
from bridge_runner import expose


@expose
async def async_add(a, b):
    """Async addition with a tiny delay."""
    await asyncio.sleep(0.01)
    return a + b


@expose
async def async_greet(name):
    """Async greeting."""
    await asyncio.sleep(0.01)
    return f"Async hello, {name}!"
