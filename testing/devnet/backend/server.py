#!/usr/bin/env python3
"""TEST ONLY: deterministic fake lending-protocol price HTTP APIs.

All prices are integer millionths of USD. This server is deliberately confined
to loopback; /control/state is a test fixture switch, not a production API.
"""

import argparse
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

PROTOCOLS = ("atlas", "boreal", "cygnus")
PRICES = {"SOL": 198_250_000, "BTC": 64_000_000_000, "ETH": 3_200_000_000}
PHASES = ("baseline", "outlier", "updated", "unavailable")


class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.phase = "baseline"
        self.requests = {p: 0 for p in PROTOCOLS}


def handler_for(state):
    class Handler(BaseHTTPRequestHandler):
        def respond(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path = urlparse(self.path).path
            if path == "/health":
                self.respond(200, {"status": "ok", "test_only": True})
                return
            if path == "/control/state":
                with state.lock:
                    body = {"phase": state.phase, "requests": dict(state.requests)}
                self.respond(200, body)
                return
            parts = path.strip("/").split("/")
            if len(parts) != 5 or parts[:2] != ["v1", "protocols"] or parts[3] != "prices":
                self.respond(404, {"error": "unknown endpoint"})
                return
            protocol, symbol = parts[2], parts[4]
            if protocol not in PROTOCOLS or symbol not in PRICES:
                self.respond(404, {"error": "unknown protocol or asset"})
                return
            with state.lock:
                phase = state.phase
                state.requests[protocol] += 1
            if phase == "unavailable" and protocol == "cygnus":
                self.respond(503, {"error": "injected protocol backend outage"})
                return
            price = PRICES[symbol]
            if phase == "updated":
                price = price * 11 // 10
            elif phase == "outlier" and protocol == "cygnus":
                price *= 10
            self.respond(200, {
                "test_only": True, "protocol": protocol, "symbol": symbol,
                "price_micro_usd": price, "decimals": 6, "phase": phase,
                "observed_at_ms": time.time_ns() // 1_000_000,
            })

        def do_POST(self):
            if self.path != "/control/state":
                self.respond(404, {"error": "unknown endpoint"})
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 1024:
                    raise ValueError("invalid body length")
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict) or body.get("phase") not in PHASES:
                    raise ValueError("unknown phase")
            except (ValueError, TypeError):
                self.respond(400, {"error": "expected a supported phase"})
                return
            with state.lock:
                state.phase = body["phase"]
                state.requests = {p: 0 for p in PROTOCOLS}
            self.respond(200, {"phase": body["phase"]})

        def log_message(self, fmt, *args):
            print("mock backend: " + fmt % args, flush=True)

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(State()))
    print(f"TEST ONLY backend http://127.0.0.1:{server.server_port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
