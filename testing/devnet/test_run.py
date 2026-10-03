"""Offline regression tests for the test-only deployment orchestrator."""

import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("devnet_runner", Path(__file__).with_name("run.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTests(unittest.TestCase):
    def capacity(self, binary_size, buffer_size):
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / "fixture.so"
            binary.write_bytes(b"0" * binary_size)
            account = {"value": {"space": buffer_size + 37}} if buffer_size else {"value": None}
            with patch.object(runner, "rpc", return_value=account) as rpc:
                result = runner.deployment_capacity("http://localhost:8899", binary, "buffer")
                self.assertEqual(rpc.call_args.args[2][1]["commitment"], "confirmed")
                return result

    def test_rebuilt_elf_cannot_underallocate_existing_buffer(self):
        self.assertEqual(self.capacity(322920, 344472), 393216)

    def test_fresh_deploy_capacity_rounds_up_without_a_buffer(self):
        self.assertEqual(self.capacity(128168, 0), 131072)

    def test_already_funded_wallet_does_not_request_an_airdrop(self):
        with patch.object(runner, "rpc", return_value={"value": 6_000_000_000}), \
                patch.object(runner.subprocess, "run") as command:
            result = runner.fund("rpc", "address", Path("ignored-key"), {}, "devnet")
            self.assertEqual(result["airdrop"], "not needed")
            command.assert_not_called()


if __name__ == "__main__":
    unittest.main()
