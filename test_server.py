"""Tests for the pack CRUD API in server.py — stdlib only."""

import http.client
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import server


class PackAPITest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls._tmpdir = tempfile.TemporaryDirectory()
        # Point the server module at a throwaway data file.
        server.DATA_FILE = Path(cls._tmpdir.name) / "question_packs.json"
        server.USER_DATA_FILE = Path(cls._tmpdir.name) / "user_data.json"
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.GameHandler)
        cls.port = cls.httpd.server_address[1]
        cls.base = f"http://127.0.0.1:{cls.port}"
        cls._thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls._thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls._tmpdir.cleanup()

    def setUp(self):
        server.DATA_FILE.write_text("[]")
        server.USER_DATA_FILE.write_text('{"favorites": [], "retired": []}')

    def request(self, method, path, body=None):
        """Return (status, parsed_json) for a request to the test server."""
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(
            self.base + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req) as res:
                return res.status, json.loads(res.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def raw_request(self, method, path, headers):
        """Send a request with hand-rolled headers and NO body; return (status, parsed_json)."""
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            conn.putrequest(method, path)
            for key, value in headers.items():
                conn.putheader(key, value)
            conn.endheaders()
            res = conn.getresponse()
            return res.status, json.loads(res.read())
        finally:
            conn.close()

    def make_pack(self, name="Date Night"):
        status, pack = self.request("POST", "/api/packs", {"name": name})
        self.assertEqual(status, 201)
        return pack

    # ── Pack CRUD ──

    def test_list_packs_empty(self):
        status, packs = self.request("GET", "/api/packs")
        self.assertEqual(status, 200)
        self.assertEqual(packs, [])

    def test_create_pack(self):
        status, pack = self.request("POST", "/api/packs", {"name": "Date Night"})
        self.assertEqual(status, 201)
        self.assertEqual(pack["name"], "Date Night")
        self.assertEqual(pack["id"], 1)
        self.assertTrue(pack["enabled"])
        self.assertEqual(pack["questions"], [])
        status, packs = self.request("GET", "/api/packs")
        self.assertEqual(len(packs), 1)

    def test_create_pack_missing_name(self):
        status, err = self.request("POST", "/api/packs", {"name": "   "})
        self.assertEqual(status, 400)
        self.assertIn("error", err)

    def test_toggle_pack_enabled(self):
        pack = self.make_pack()
        status, updated = self.request("PUT", f"/api/packs/{pack['id']}", {"enabled": False})
        self.assertEqual(status, 200)
        self.assertFalse(updated["enabled"])

    def test_rename_pack(self):
        pack = self.make_pack()
        status, updated = self.request("PUT", f"/api/packs/{pack['id']}", {"name": "  New Name  "})
        self.assertEqual(status, 200)
        self.assertEqual(updated["name"], "New Name")

    def test_update_unknown_pack_404(self):
        status, err = self.request("PUT", "/api/packs/999", {"enabled": False})
        self.assertEqual(status, 404)

    def test_delete_pack(self):
        pack = self.make_pack()
        status, body = self.request("DELETE", f"/api/packs/{pack['id']}")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"ok": True})
        status, packs = self.request("GET", "/api/packs")
        self.assertEqual(packs, [])

    # ── Question CRUD ──

    def test_add_question(self):
        pack = self.make_pack()
        status, q = self.request(
            "POST", f"/api/packs/{pack['id']}/questions",
            {"text": "What made you smile today?", "rarity": "rare", "category": "Custom"},
        )
        self.assertEqual(status, 201)
        self.assertEqual(q["id"], 1)
        self.assertEqual(q["text"], "What made you smile today?")
        self.assertEqual(q["rarity"], "rare")
        status, packs = self.request("GET", "/api/packs")
        self.assertEqual(len(packs[0]["questions"]), 1)

    def test_add_question_missing_text(self):
        pack = self.make_pack()
        status, err = self.request("POST", f"/api/packs/{pack['id']}/questions", {"text": "  "})
        self.assertEqual(status, 400)
        self.assertIn("error", err)

    def test_add_question_unknown_pack_404(self):
        status, err = self.request("POST", "/api/packs/999/questions", {"text": "Hello?"})
        self.assertEqual(status, 404)

    def test_delete_question(self):
        pack = self.make_pack()
        _, q = self.request("POST", f"/api/packs/{pack['id']}/questions", {"text": "Q?"})
        status, body = self.request("DELETE", f"/api/packs/{pack['id']}/questions/{q['id']}")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"ok": True})
        status, packs = self.request("GET", "/api/packs")
        self.assertEqual(packs[0]["questions"], [])

    def test_delete_question_unknown_pack_404(self):
        status, err = self.request("DELETE", "/api/packs/999/questions/1")
        self.assertEqual(status, 404)

    # ── Marks ──

    def test_get_marks_empty(self):
        status, marks = self.request("GET", "/api/marks")
        self.assertEqual(status, 200)
        self.assertEqual(marks, {"favorites": [], "retired": []})

    def test_add_and_remove_favorite(self):
        status, marks = self.request("POST", "/api/marks/favorites/b12")
        self.assertEqual(status, 200)
        self.assertEqual(marks["favorites"], ["b12"])
        # idempotent add
        status, marks = self.request("POST", "/api/marks/favorites/b12")
        self.assertEqual(marks["favorites"], ["b12"])
        status, marks = self.request("DELETE", "/api/marks/favorites/b12")
        self.assertEqual(status, 200)
        self.assertEqual(marks["favorites"], [])
        # idempotent remove
        status, marks = self.request("DELETE", "/api/marks/favorites/b12")
        self.assertEqual(status, 200)

    def test_retired_list_independent_of_favorites(self):
        self.request("POST", "/api/marks/favorites/b1")
        status, marks = self.request("POST", "/api/marks/retired/p3-2")
        self.assertEqual(marks, {"favorites": ["b1"], "retired": ["p3-2"]})

    def test_malformed_mark_key_400(self):
        for bad in ("x9", "b", "p3", "p3-2-1", "b1;rm"):
            status, err = self.request("POST", f"/api/marks/favorites/{bad}")
            self.assertEqual(status, 400, f"key {bad!r} should be rejected")
            self.assertIn("error", err)

    def test_unknown_mark_list_404(self):
        status, err = self.request("POST", "/api/marks/loved/b1")
        self.assertEqual(status, 404)

    def test_marks_persist_to_user_data_file(self):
        self.request("POST", "/api/marks/retired/b40")
        on_disk = json.loads(server.USER_DATA_FILE.read_text())
        self.assertEqual(on_disk["retired"], ["b40"])

    def test_data_dir_env_override(self):
        out = subprocess.check_output(
            [sys.executable, "-c",
             "import server; print(server.DATA_FILE); print(server.USER_DATA_FILE)"],
            env={**os.environ, "DATA_DIR": "/tmp/cq-data"},
            cwd=str(Path(__file__).parent),
        ).decode().strip().splitlines()
        self.assertEqual(out[0], "/tmp/cq-data/question_packs.json")
        self.assertEqual(out[1], "/tmp/cq-data/user_data.json")

    # ── Caching ──

    def test_responses_disable_heuristic_caching(self):
        # Without Cache-Control, browsers heuristically cache static files
        # and keep running stale app.js after edits.
        for path in ("/", "/app.js", "/api/packs"):
            with urllib.request.urlopen(self.base + path) as res:
                self.assertEqual(
                    res.headers.get("Cache-Control"), "no-cache",
                    f"missing Cache-Control on {path}",
                )

    # ── Hardening ──

    def test_oversized_body_rejected_413(self):
        # Claim a huge body via Content-Length without sending it; the
        # server must reject from the header alone, before reading.
        status, err = self.raw_request(
            "POST", "/api/packs",
            {"Content-Type": "application/json", "Content-Length": str(2_000_000)},
        )
        self.assertEqual(status, 413)
        self.assertIn("error", err)

    def test_pack_name_too_long_400(self):
        status, err = self.request("POST", "/api/packs", {"name": "x" * 61})
        self.assertEqual(status, 400)
        self.assertIn("error", err)

    def test_rename_too_long_400(self):
        pack = self.make_pack()
        status, err = self.request("PUT", f"/api/packs/{pack['id']}", {"name": "x" * 61})
        self.assertEqual(status, 400)
        _, packs = self.request("GET", "/api/packs")
        self.assertEqual(packs[0]["name"], "Date Night")  # unchanged

    def test_question_text_too_long_400(self):
        pack = self.make_pack()
        status, err = self.request(
            "POST", f"/api/packs/{pack['id']}/questions", {"text": "x" * 301}
        )
        self.assertEqual(status, 400)

    def test_concurrent_pack_creates_do_not_lose_writes(self):
        errors = []

        def create(i):
            try:
                status, _ = self.request("POST", "/api/packs", {"name": f"Pack {i}"})
                if status != 201:
                    errors.append(status)
            except Exception as e:  # noqa: BLE001 — collect for assertion
                errors.append(e)

        threads = [threading.Thread(target=create, args=(i,)) for i in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(errors, [])
        status, packs = self.request("GET", "/api/packs")
        self.assertEqual(len(packs), 10)
        ids = [p["id"] for p in packs]
        self.assertEqual(len(set(ids)), 10, f"duplicate ids: {ids}")


if __name__ == "__main__":
    unittest.main()
