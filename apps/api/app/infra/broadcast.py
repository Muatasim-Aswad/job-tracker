"""Bounded live fanout. Durable messages belong in the database."""

import asyncio
import threading
from dataclasses import dataclass


@dataclass(frozen=True)
class Message:
    event: str
    data: dict[str, object]


class BroadcastHub:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subscribers: dict[asyncio.Queue[Message], asyncio.AbstractEventLoop] = {}

    def subscribe(self) -> asyncio.Queue[Message]:
        queue: asyncio.Queue[Message] = asyncio.Queue(maxsize=100)
        with self._lock:
            self._subscribers[queue] = asyncio.get_running_loop()
        return queue

    def unsubscribe(self, queue: asyncio.Queue[Message]) -> None:
        with self._lock:
            self._subscribers.pop(queue, None)

    @property
    def connected(self) -> bool:
        with self._lock:
            return bool(self._subscribers)

    def publish(self, event: str, data: dict[str, object]) -> None:
        with self._lock:
            subscribers = list(self._subscribers.items())
        message = Message(event, data)
        for queue, loop in subscribers:
            if not loop.is_closed():
                loop.call_soon_threadsafe(self._offer, queue, message)

    @staticmethod
    def _offer(queue: asyncio.Queue[Message], message: Message) -> None:
        if queue.full():
            queue.get_nowait()
            message = Message("sync", {})
        queue.put_nowait(message)
