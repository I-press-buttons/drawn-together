"""Tests for the pack CRUD API in server.py — stdlib only."""

import http.client
import json
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


if __name__ == "__main__":
    unittest.main()
