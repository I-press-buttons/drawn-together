#!/usr/bin/env python3
"""Couple Question Game — custom Python server with pack-based question storage."""

import http.server
import json
import os
import re
import hashlib
from pathlib import Path

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", 8080))
DATA_FILE = Path(__file__).parent / "question_packs.json"


def load_packs():
    if DATA_FILE.exists():
        try:
            return json.loads(DATA_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return []


def save_packs(packs):
    DATA_FILE.write_text(json.dumps(packs, indent=2, ensure_ascii=False))


def json_response(handler, data, status=200):
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_json_body(handler):
    length = int(handler.headers.get("Content-Length", 0))
    if length == 0:
        return {}
    return json.loads(handler.rfile.read(length))


class GameHandler(http.server.SimpleHTTPRequestHandler):

    def do_GET(self):
        # ── List all packs ──
        if self.path == "/api/packs":
            json_response(self, load_packs())
            return

        # ── Static files ──
        super().do_GET()

    def do_POST(self):
        # ── Create a new pack ──
        if self.path == "/api/packs":
            body = read_json_body(self)
            name = body.get("name", "").strip()
            if not name:
                json_response(self, {"error": "Pack name required"}, 400)
                return
            packs = load_packs()
            new_pack = {
                "id": _next_id(packs),
                "name": name,
                "enabled": True,
                "questions": [],
            }
            packs.append(new_pack)
            save_packs(packs)
            json_response(self, new_pack, 201)
            return

        # ── Add question to a pack ──
        m = re.match(r"^/api/packs/(\d+)/questions$", self.path)
        if m:
            pack_id = int(m.group(1))
            packs = load_packs()
            for pack in packs:
                if pack["id"] != pack_id:
                    continue
                body = read_json_body(self)
                text = body.get("text", "").strip()
                if not text:
                    json_response(self, {"error": "Question text required"}, 400)
                    return
                q = {
                    "id": _next_id(pack.get("questions", [])),
                    "text": text,
                    "rarity": body.get("rarity", "common"),
                    "category": body.get("category", "Custom"),
                }
                pack.setdefault("questions", []).append(q)
                save_packs(packs)
                json_response(self, q, 201)
                return
            json_response(self, {"error": "Pack not found"}, 404)
            return

        json_response(self, {"error": "Not found"}, 404)

    def do_PUT(self):
        # ── Update a pack (toggle enabled, rename) ──
        m = re.match(r"^/api/packs/(\d+)$", self.path)
        if m:
            pack_id = int(m.group(1))
            body = read_json_body(self)
            packs = load_packs()
            for pack in packs:
                if pack["id"] != pack_id:
                    continue
                if "enabled" in body:
                    pack["enabled"] = bool(body["enabled"])
                if "name" in body:
                    pack["name"] = body["name"].strip()
                save_packs(packs)
                json_response(self, pack)
                return
            json_response(self, {"error": "Pack not found"}, 404)
            return

        json_response(self, {"error": "Not found"}, 404)

    def do_DELETE(self):
        # ── Delete entire pack ──
        m = re.match(r"^/api/packs/(\d+)$", self.path)
        if m:
            pack_id = int(m.group(1))
            packs = load_packs()
            packs = [p for p in packs if p["id"] != pack_id]
            save_packs(packs)
            json_response(self, {"ok": True})
            return

        # ── Delete a question from a pack ──
        m = re.match(r"^/api/packs/(\d+)/questions/(\d+)$", self.path)
        if m:
            pack_id, qid = int(m.group(1)), int(m.group(2))
            packs = load_packs()
            for pack in packs:
                if pack["id"] != pack_id:
                    continue
                pack["questions"] = [q for q in pack["questions"] if q["id"] != qid]
                save_packs(packs)
                json_response(self, {"ok": True})
                return
            json_response(self, {"error": "Pack not found"}, 404)

        json_response(self, {"error": "Not found"}, 404)

    def log_message(self, fmt, *args):
        # Quieter logging — only API calls
        if not self.path.startswith("/api"):
            return
        super().log_message(fmt, *args)


def _next_id(items):
    return max((item.get("id", 0) for item in items), default=0) + 1


if __name__ == "__main__":
    httpd = http.server.HTTPServer((HOST, PORT), GameHandler)
    # Serve from the directory where server.py lives
    os.chdir(Path(__file__).parent)
    print(f"Serving at http://{HOST}:{PORT}")
    httpd.serve_forever()