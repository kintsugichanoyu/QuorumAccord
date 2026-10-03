import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from server import PRICES, PROTOCOLS, State, handler_for


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(State()))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def get(self, path):
        with urlopen(self.url + path, timeout=3) as response:
            return json.load(response)

    def phase(self, phase):
        request = Request(self.url + "/control/state", json.dumps({"phase": phase}).encode(),
                          {"Content-Type": "application/json"})
        with urlopen(request, timeout=3) as response:
            return json.load(response)

    def test_three_protocols_return_integer_prices(self):
        for protocol in PROTOCOLS:
            for symbol, price in PRICES.items():
                quote = self.get(f"/v1/protocols/{protocol}/prices/{symbol}")
                self.assertEqual(quote["price_micro_usd"], price)
                self.assertEqual(quote["decimals"], 6)
                self.assertTrue(quote["test_only"])
        self.assertEqual(self.get("/control/state")["requests"], dict.fromkeys(PROTOCOLS, 3))

    def test_updated_prices_and_one_bad_protocol(self):
        self.phase("updated")
        self.assertEqual(self.get("/v1/protocols/atlas/prices/SOL")["price_micro_usd"], PRICES["SOL"] * 11 // 10)
        self.phase("outlier")
        self.assertEqual(self.get("/v1/protocols/cygnus/prices/SOL")["price_micro_usd"], PRICES["SOL"] * 10)
        self.assertEqual(self.get("/v1/protocols/atlas/prices/SOL")["price_micro_usd"], PRICES["SOL"])

    def test_outage_is_explicit_http_error(self):
        self.phase("unavailable")
        with self.assertRaises(HTTPError) as error:
            self.get("/v1/protocols/cygnus/prices/SOL")
        self.assertEqual(error.exception.code, 503)

    def test_unknown_assets_and_phases_fail(self):
        with self.assertRaises(HTTPError) as error:
            self.get("/v1/protocols/atlas/prices/UNKNOWN")
        self.assertEqual(error.exception.code, 404)
        with self.assertRaises(HTTPError) as error:
            self.phase("invalid")
        self.assertEqual(error.exception.code, 400)


if __name__ == "__main__":
    unittest.main()
