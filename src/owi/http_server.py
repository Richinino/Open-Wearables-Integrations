"""Waitress transport with bounded connections and workers, also on Windows."""

from __future__ import annotations

import threading
from typing import Any

from waitress import wasyncore
from waitress.server import create_server


class ApiServer:
    def __init__(self, application: Any, host: str, port: int, max_body: int) -> None:
        self._map: dict = {}
        self._stopped = threading.Event()
        self._done = threading.Event()
        self._done.set()
        self._server = create_server(
            application,
            map=self._map,
            host=host,
            port=port,
            threads=8,
            connection_limit=64,
            backlog=64,
            channel_timeout=15,
            cleanup_interval=5,
            max_request_header_size=16_384,
            max_request_body_size=max_body,
            expose_tracebacks=False,
            ident="owi",
        )
        self.server_address = (host, int(self._server.effective_port))

    def serve_forever(self) -> None:
        self._done.clear()
        try:
            while not self._stopped.is_set():
                wasyncore.loop(timeout=0.1, count=1, map=self._map)
        finally:
            self._done.set()

    def shutdown(self) -> None:
        self._stopped.set()
        self._done.wait(timeout=2)

    def server_close(self) -> None:
        self.shutdown()
        self._server.task_dispatcher.shutdown()
        wasyncore.close_all(map=self._map)
