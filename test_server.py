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
        server.FEATURED_PACKS_FILE = Path(cls._tmpdir.name) / "featured_packs.json"
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
        server.FEATURED_PACKS_FILE.write_text(json.dumps([
            {"key": "biblical-marriage", "name": "Biblical Marriage", "questions": []}
        ]))

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

    # ── Moving questions between packs ──

    def make_move_fixture(self):
        """Source pack with 3 questions + empty target pack."""
        src = self.make_pack("Source")
        dst = self.make_pack("Target")
        qs = []
        for text in ["Q one?", "Q two?", "Q three?"]:
            _, q = self.request("POST", f"/api/packs/{src['id']}/questions", {"text": text})
            qs.append(q)
        return src, dst, qs

    def test_move_questions(self):
        src, dst, qs = self.make_move_fixture()
        status, body = self.request(
            "POST", f"/api/packs/{src['id']}/questions/move",
            {"toPackId": dst["id"], "qids": [qs[0]["id"], qs[2]["id"]]},
        )
        self.assertEqual(status, 200)
        self.assertEqual(len(body["moved"]), 2)
        self.assertEqual(body["moved"][0]["oldQkey"], f"p{src['id']}-{qs[0]['id']}")
        self.assertEqual(body["moved"][0]["question"]["text"], "Q one?")
        _, packs = self.request("GET", "/api/packs")
        by_id = {p["id"]: p for p in packs}
        self.assertEqual([q["text"] for q in by_id[src["id"]]["questions"]], ["Q two?"])
        self.assertEqual(
            [q["text"] for q in by_id[dst["id"]]["questions"]], ["Q one?", "Q three?"])

    def test_move_reassigns_colliding_ids(self):
        src, dst, qs = self.make_move_fixture()
        _, existing = self.request(
            "POST", f"/api/packs/{dst['id']}/questions", {"text": "Existing?"})
        # qs[0] has id 1, which collides with `existing` (also id 1) in the target
        status, body = self.request(
            "POST", f"/api/packs/{src['id']}/questions/move",
            {"toPackId": dst["id"], "qids": [qs[0]["id"]]},
        )
        self.assertEqual(status, 200)
        moved_q = body["moved"][0]["question"]
        self.assertNotEqual(moved_q["id"], existing["id"])
        self.assertEqual(body["moved"][0]["newQkey"], f"p{dst['id']}-{moved_q['id']}")

    def test_move_rewrites_marks(self):
        src, dst, qs = self.make_move_fixture()
        self.request("POST", f"/api/marks/favorites/p{src['id']}-{qs[0]['id']}")
        self.request("POST", f"/api/marks/retired/p{src['id']}-{qs[1]['id']}")
        _, body = self.request(
            "POST", f"/api/packs/{src['id']}/questions/move",
            {"toPackId": dst["id"], "qids": [qs[0]["id"], qs[1]["id"]]},
        )
        _, marks = self.request("GET", "/api/marks")
        self.assertEqual(marks["favorites"], [body["moved"][0]["newQkey"]])
        self.assertEqual(marks["retired"], [body["moved"][1]["newQkey"]])

    def test_move_to_same_pack_400(self):
        src, dst, qs = self.make_move_fixture()
        status, err = self.request(
            "POST", f"/api/packs/{src['id']}/questions/move",
            {"toPackId": src["id"], "qids": [qs[0]["id"]]},
        )
        self.assertEqual(status, 400)
        self.assertIn("error", err)

    def test_move_empty_or_missing_qids_400(self):
        src, dst, qs = self.make_move_fixture()
        for bad_body in ({"toPackId": dst["id"], "qids": []},
                         {"toPackId": dst["id"]},
                         {"qids": [qs[0]["id"]]}):
            status, err = self.request(
                "POST", f"/api/packs/{src['id']}/questions/move", bad_body)
            self.assertEqual(status, 400)

    def test_move_unknown_pack_404(self):
        src, dst, qs = self.make_move_fixture()
        status, _ = self.request(
            "POST", "/api/packs/999/questions/move",
            {"toPackId": dst["id"], "qids": [qs[0]["id"]]})
        self.assertEqual(status, 404)
        status, _ = self.request(
            "POST", f"/api/packs/{src['id']}/questions/move",
            {"toPackId": 999, "qids": [qs[0]["id"]]})
        self.assertEqual(status, 404)

    def test_move_unknown_qid_is_all_or_nothing_404(self):
        src, dst, qs = self.make_move_fixture()
        status, _ = self.request(
            "POST", f"/api/packs/{src['id']}/questions/move",
            {"toPackId": dst["id"], "qids": [qs[0]["id"], 999]})
        self.assertEqual(status, 404)
        _, packs = self.request("GET", "/api/packs")
        by_id = {p["id"]: p for p in packs}
        self.assertEqual(len(by_id[src["id"]]["questions"]), 3)  # nothing moved
        self.assertEqual(by_id[dst["id"]]["questions"], [])

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

    # ── Featured pack prefs ──

    def test_featured_prefs_default_empty(self):
        status, prefs = self.request("GET", "/api/featured-pack-prefs")
        self.assertEqual(status, 200)
        self.assertEqual(prefs, {})

    def test_set_featured_pref(self):
        status, prefs = self.request(
            "PUT", "/api/featured-pack-prefs/biblical-marriage", {"enabled": False})
        self.assertEqual(status, 200)
        self.assertEqual(prefs, {"biblical-marriage": False})
        status, prefs = self.request("GET", "/api/featured-pack-prefs")
        self.assertEqual(prefs, {"biblical-marriage": False})
        status, prefs = self.request(
            "PUT", "/api/featured-pack-prefs/biblical-marriage", {"enabled": True})
        self.assertEqual(prefs, {"biblical-marriage": True})

    def test_set_featured_pref_unknown_key_404(self):
        status, err = self.request(
            "PUT", "/api/featured-pack-prefs/no-such-pack", {"enabled": False})
        self.assertEqual(status, 404)
        self.assertIn("error", err)

    def test_set_featured_pref_requires_boolean(self):
        for bad in ({}, {"enabled": "false"}, {"enabled": 0}):
            status, err = self.request(
                "PUT", "/api/featured-pack-prefs/biblical-marriage", bad)
            self.assertEqual(status, 400)
            self.assertIn("error", err)

    def test_featured_prefs_survive_other_user_data_writes(self):
        """load_user_data must round-trip featuredPackPrefs, not drop it."""
        self.request("PUT", "/api/featured-pack-prefs/biblical-marriage", {"enabled": False})
        self.request("POST", "/api/marks/favorites/b12")
        self.request("PUT", "/api/session", {"score": 3})
        status, prefs = self.request("GET", "/api/featured-pack-prefs")
        self.assertEqual(prefs, {"biblical-marriage": False})
        status, marks = self.request("GET", "/api/marks")
        self.assertEqual(set(marks.keys()), {"favorites", "retired"})

    def test_mark_featured_question(self):
        status, marks = self.request("POST", "/api/marks/favorites/fbiblical-marriage-3")
        self.assertEqual(status, 200)
        self.assertEqual(marks["favorites"], ["fbiblical-marriage-3"])
        status, marks = self.request("DELETE", "/api/marks/favorites/fbiblical-marriage-3")
        self.assertEqual(marks["favorites"], [])

    def test_mark_invalid_featured_key_rejected(self):
        for bad in ("f-1", "fUPPER-1", "fbiblical-marriage-", "fbiblical-marriage-x"):
            status, err = self.request("POST", f"/api/marks/favorites/{bad}")
            self.assertEqual(status, 400)

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

    # ── Question editing ──

    def test_edit_question_text_and_rarity(self):
        pack = self.make_pack()
        _, q = self.request("POST", f"/api/packs/{pack['id']}/questions", {"text": "Old?"})
        status, updated = self.request(
            "PUT", f"/api/packs/{pack['id']}/questions/{q['id']}",
            {"text": "  New?  ", "rarity": "mythic"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(updated["text"], "New?")
        self.assertEqual(updated["rarity"], "mythic")
        _, packs = self.request("GET", "/api/packs")
        self.assertEqual(packs[0]["questions"][0]["text"], "New?")

    def test_edit_question_partial_category_only(self):
        pack = self.make_pack()
        _, q = self.request("POST", f"/api/packs/{pack['id']}/questions", {"text": "Q?"})
        status, updated = self.request(
            "PUT", f"/api/packs/{pack['id']}/questions/{q['id']}", {"category": "Future Us"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(updated["category"], "Future Us")
        self.assertEqual(updated["text"], "Q?")

    def test_edit_question_empty_text_400(self):
        pack = self.make_pack()
        _, q = self.request("POST", f"/api/packs/{pack['id']}/questions", {"text": "Q?"})
        status, err = self.request(
            "PUT", f"/api/packs/{pack['id']}/questions/{q['id']}", {"text": "   "},
        )
        self.assertEqual(status, 400)

    def test_edit_question_too_long_400(self):
        pack = self.make_pack()
        _, q = self.request("POST", f"/api/packs/{pack['id']}/questions", {"text": "Q?"})
        status, err = self.request(
            "PUT", f"/api/packs/{pack['id']}/questions/{q['id']}", {"text": "x" * 301},
        )
        self.assertEqual(status, 400)

    def test_edit_unknown_question_404(self):
        pack = self.make_pack()
        status, err = self.request("PUT", f"/api/packs/{pack['id']}/questions/99", {"text": "Q?"})
        self.assertEqual(status, 404)
        status, err = self.request("PUT", "/api/packs/999/questions/1", {"text": "Q?"})
        self.assertEqual(status, 404)

    # ── Session (resume) ──

    def test_session_initially_null(self):
        status, body = self.request("GET", "/api/session")
        self.assertEqual(status, 200)
        self.assertIsNone(body["session"])

    def test_save_and_load_session(self):
        session = {
            "deckKeys": ["b1", "b2"], "discardKeys": [], "currentKey": None,
            "score": 3, "questionsAnswered": 1, "rarestKey": None, "sessionHearts": 0,
        }
        status, saved = self.request("PUT", "/api/session", session)
        self.assertEqual(status, 200)
        self.assertEqual(saved["session"], session)
        status, body = self.request("GET", "/api/session")
        self.assertEqual(status, 200)
        self.assertEqual(body["session"], session)

    def test_save_session_overwrites_previous(self):
        self.request("PUT", "/api/session", {"deckKeys": ["b1"]})
        self.request("PUT", "/api/session", {"deckKeys": ["b2", "b3"]})
        status, body = self.request("GET", "/api/session")
        self.assertEqual(status, 200)
        self.assertEqual(body["session"], {"deckKeys": ["b2", "b3"]})

    def test_clear_session(self):
        self.request("PUT", "/api/session", {"deckKeys": ["b1"]})
        status, body = self.request("DELETE", "/api/session")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"ok": True})
        status, body = self.request("GET", "/api/session")
        self.assertEqual(status, 200)
        self.assertIsNone(body["session"])

    def test_clear_session_when_none_saved(self):
        status, body = self.request("DELETE", "/api/session")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"ok": True})

    def test_save_session_rejects_non_object_body(self):
        status, err = self.request("PUT", "/api/session", ["not", "an", "object"])
        self.assertEqual(status, 400)
        self.assertIn("error", err)
        status, body = self.request("GET", "/api/session")
        self.assertIsNone(body["session"])

    def test_marks_endpoint_excludes_session(self):
        self.request("PUT", "/api/session", {"deckKeys": ["b1"]})
        status, marks = self.request("GET", "/api/marks")
        self.assertEqual(status, 200)
        self.assertEqual(set(marks.keys()), {"favorites", "retired"})

    def test_session_persists_to_user_data_file(self):
        session = {"deckKeys": ["b7"]}
        self.request("PUT", "/api/session", session)
        on_disk = json.loads(server.USER_DATA_FILE.read_text())
        self.assertEqual(on_disk["session"], session)

    def test_saving_session_preserves_existing_marks(self):
        self.request("POST", "/api/marks/favorites/b12")
        self.request("PUT", "/api/session", {"deckKeys": ["b1"]})
        status, marks = self.request("GET", "/api/marks")
        self.assertEqual(marks["favorites"], ["b12"])

    def test_adding_mark_preserves_existing_session(self):
        session = {"deckKeys": ["b1"]}
        self.request("PUT", "/api/session", session)
        self.request("POST", "/api/marks/favorites/b12")
        status, body = self.request("GET", "/api/session")
        self.assertEqual(body["session"], session)

    # ── Mark cleanup ──

    def test_deleting_question_removes_its_marks(self):
        pack = self.make_pack()
        _, q = self.request("POST", f"/api/packs/{pack['id']}/questions", {"text": "Q?"})
        qkey = f"p{pack['id']}-{q['id']}"
        self.request("POST", f"/api/marks/favorites/{qkey}")
        self.request("POST", "/api/marks/favorites/b7")
        self.request("DELETE", f"/api/packs/{pack['id']}/questions/{q['id']}")
        _, marks = self.request("GET", "/api/marks")
        self.assertEqual(marks["favorites"], ["b7"])

    def test_deleting_pack_removes_all_its_marks(self):
        pack = self.make_pack()
        _, q1 = self.request("POST", f"/api/packs/{pack['id']}/questions", {"text": "A?"})
        _, q2 = self.request("POST", f"/api/packs/{pack['id']}/questions", {"text": "B?"})
        self.request("POST", f"/api/marks/favorites/p{pack['id']}-{q1['id']}")
        self.request("POST", f"/api/marks/retired/p{pack['id']}-{q2['id']}")
        self.request("POST", "/api/marks/retired/b3")
        self.request("DELETE", f"/api/packs/{pack['id']}")
        _, marks = self.request("GET", "/api/marks")
        self.assertEqual(marks, {"favorites": [], "retired": ["b3"]})

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

    # ── Background pref ──

    def test_background_default_null(self):
        status, data = self.request("GET", "/api/background")
        self.assertEqual(status, 200)
        self.assertIsNone(data["background"])

    def test_set_background_and_read_back(self):
        status, data = self.request("PUT", "/api/background", {"background": "sunset"})
        self.assertEqual(status, 200)
        self.assertEqual(data["background"], "sunset")
        status, data = self.request("GET", "/api/background")
        self.assertEqual(status, 200)
        self.assertEqual(data["background"], "sunset")

    def test_set_background_unknown_key_400(self):
        status, err = self.request("PUT", "/api/background", {"background": "hawaii"})
        self.assertEqual(status, 400)
        self.assertIn("error", err)

    def test_set_background_bad_body_400(self):
        status, err = self.request("PUT", "/api/background", {"nope": True})
        self.assertEqual(status, 400)
        self.assertIn("error", err)
        status, err = self.request("PUT", "/api/background", {"background": 7})
        self.assertEqual(status, 400)
        self.assertIn("error", err)


if __name__ == "__main__":
    unittest.main()
