#!/usr/bin/env python3
"""Drawn Together — custom Python server with pack-based question storage."""

import http.server
import json
import os
import re
import threading
from pathlib import Path

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", 8080))
DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).parent))
DATA_FILE = DATA_DIR / "question_packs.json"
USER_DATA_FILE = DATA_DIR / "user_data.json"

MAX_BODY_BYTES = 1_000_000   # reject request bodies larger than ~1 MB
MAX_NAME_LEN = 60            # matches maxlength on #newPackName in index.html
MAX_QUESTION_LEN = 300       # matches maxlength on the pack-add-input in index.html

# Serializes every load_packs() -> mutate -> save_packs() sequence so two
# clients editing packs at once can't overwrite each other's writes.
PACKS_LOCK = threading.Lock()

MARK_LISTS = ("favorites", "retired")
MARK_KEY_RE = re.compile(r"^(b\d+|p\d+-\d+)$")


def load_packs():
    if DATA_FILE.exists():
        try:
            return json.loads(DATA_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return []


def save_packs(packs):
    DATA_FILE.write_text(json.dumps(packs, indent=2, ensure_ascii=False))


def load_user_data():
    if USER_DATA_FILE.exists():
        try:
            raw = json.loads(USER_DATA_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            raw = {}
    else:
        raw = {}
    data = {k: list(raw.get(k, [])) for k in MARK_LISTS}
    data["session"] = raw.get("session")
    return data


def save_user_data(data):
    USER_DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False))


def load_session():
    return load_user_data().get("session")


def save_session(session):
    data = load_user_data()
    data["session"] = session
    save_user_data(data)


def clear_session():
    data = load_user_data()
    data["session"] = None
    save_user_data(data)


def remove_marks(predicate):
    """Drop every mark key matching predicate from both lists. Caller holds PACKS_LOCK."""
    data = load_user_data()
    changed = False
    for lst in MARK_LISTS:
        kept = [k for k in data[lst] if not predicate(k)]
        if len(kept) != len(data[lst]):
            data[lst] = kept
            changed = True
    if changed:
        save_user_data(data)


def json_response(handler, data, status=200):
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def handle_mark_change(handler, path, add):
    """Route helper for POST/DELETE /api/marks/<list>/<qkey>. Returns True if handled."""
    m = re.match(r"^/api/marks/([^/]+)/([^/]+)$", path)
    if not m:
        return False
    list_name, qkey = m.group(1), m.group(2)
    if list_name not in MARK_LISTS:
        json_response(handler, {"error": "Unknown mark list"}, 404)
        return True
    if not MARK_KEY_RE.match(qkey):
        json_response(handler, {"error": "Invalid question key"}, 400)
        return True
    with PACKS_LOCK:
        data = load_user_data()
        if add and qkey not in data[list_name]:
            data[list_name].append(qkey)
            save_user_data(data)
        elif not add and qkey in data[list_name]:
            data[list_name].remove(qkey)
            save_user_data(data)
    json_response(handler, {k: data[k] for k in MARK_LISTS})
    return True


def read_json_body(handler):
    """Read and parse the JSON request body.

    Sends a 413 and returns None if Content-Length exceeds MAX_BODY_BYTES,
    so callers must bail out with `if body is None: return`.
    """
    length = int(handler.headers.get("Content-Length", 0))
    if length > MAX_BODY_BYTES:
        json_response(handler, {"error": "Request body too large"}, 413)
        return None
    if length == 0:
        return {}
    return json.loads(handler.rfile.read(length))


class GameHandler(http.server.SimpleHTTPRequestHandler):

    def end_headers(self):
        # Force browsers to revalidate on every request; without this,
        # heuristic caching keeps serving stale app.js/style.css after edits.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        # ── List all packs ──
        if self.path == "/api/packs":
            json_response(self, load_packs())
            return

        # ── User marks (favorites / retired) ──
        if self.path == "/api/marks":
            data = load_user_data()
            json_response(self, {k: data[k] for k in MARK_LISTS})
            return

        # ── Saved session (resume) ──
        if self.path == "/api/session":
            json_response(self, {"session": load_session()})
            return

        # ── Static files ──
        super().do_GET()

    def do_POST(self):
        # ── Create a new pack ──
        if self.path == "/api/packs":
            body = read_json_body(self)
            if body is None:
                return
            name = body.get("name", "").strip()
            if not name:
                json_response(self, {"error": "Pack name required"}, 400)
                return
            if len(name) > MAX_NAME_LEN:
                json_response(self, {"error": f"Pack name must be {MAX_NAME_LEN} characters or fewer"}, 400)
                return
            with PACKS_LOCK:
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
            body = read_json_body(self)
            if body is None:
                return
            text = body.get("text", "").strip()
            if not text:
                json_response(self, {"error": "Question text required"}, 400)
                return
            if len(text) > MAX_QUESTION_LEN:
                json_response(self, {"error": f"Question text must be {MAX_QUESTION_LEN} characters or fewer"}, 400)
                return
            with PACKS_LOCK:
                packs = load_packs()
                for pack in packs:
                    if pack["id"] != pack_id:
                        continue
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

        # ── Move questions to another pack ──
        m = re.match(r"^/api/packs/(\d+)/questions/move$", self.path)
        if m:
            from_id = int(m.group(1))
            body = read_json_body(self)
            if body is None:
                return
            to_id = body.get("toPackId")
            qids = body.get("qids")
            if not isinstance(to_id, int) or not isinstance(qids, list) or not qids \
                    or not all(isinstance(q, int) for q in qids):
                json_response(self, {"error": "toPackId and a non-empty qids list required"}, 400)
                return
            if to_id == from_id:
                json_response(self, {"error": "Source and target pack are the same"}, 400)
                return
            qids = list(dict.fromkeys(qids))  # de-dupe, keep order
            with PACKS_LOCK:
                packs = load_packs()
                src = next((p for p in packs if p["id"] == from_id), None)
                dst = next((p for p in packs if p["id"] == to_id), None)
                if src is None or dst is None:
                    json_response(self, {"error": "Pack not found"}, 404)
                    return
                by_id = {q["id"]: q for q in src.get("questions", [])}
                if any(qid not in by_id for qid in qids):
                    json_response(self, {"error": "Question not found in source pack"}, 404)
                    return
                dst.setdefault("questions", [])
                data = load_user_data()
                marks_changed = False
                moved = []
                for qid in qids:
                    q = by_id[qid]
                    src["questions"].remove(q)
                    new_qid = qid
                    if any(t["id"] == new_qid for t in dst["questions"]):
                        new_qid = _next_id(dst["questions"])
                    q = {**q, "id": new_qid}
                    dst["questions"].append(q)
                    old_qkey, new_qkey = f"p{from_id}-{qid}", f"p{to_id}-{new_qid}"
                    for lst in MARK_LISTS:
                        if old_qkey in data[lst]:
                            data[lst] = [new_qkey if k == old_qkey else k for k in data[lst]]
                            marks_changed = True
                    moved.append({"oldQkey": old_qkey, "newQkey": new_qkey, "question": q})
                save_packs(packs)
                if marks_changed:
                    save_user_data(data)
            json_response(self, {"moved": moved})
            return

        # ── Add a mark ──
        if handle_mark_change(self, self.path, add=True):
            return

        json_response(self, {"error": "Not found"}, 404)

    def do_PUT(self):
        # ── Save session (resume) ──
        if self.path == "/api/session":
            body = read_json_body(self)
            if body is None:
                return
            if not isinstance(body, dict):
                json_response(self, {"error": "Session must be a JSON object"}, 400)
                return
            with PACKS_LOCK:
                save_session(body)
            json_response(self, {"session": body})
            return

        # ── Update a pack (toggle enabled, rename) ──
        m = re.match(r"^/api/packs/(\d+)$", self.path)
        if m:
            pack_id = int(m.group(1))
            body = read_json_body(self)
            if body is None:
                return
            if "name" in body and len(body["name"].strip()) > MAX_NAME_LEN:
                json_response(self, {"error": f"Pack name must be {MAX_NAME_LEN} characters or fewer"}, 400)
                return
            with PACKS_LOCK:
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

        # ── Edit a question in a pack ──
        m = re.match(r"^/api/packs/(\d+)/questions/(\d+)$", self.path)
        if m:
            pack_id, qid = int(m.group(1)), int(m.group(2))
            body = read_json_body(self)
            if body is None:
                return
            text = None
            if "text" in body:
                text = body["text"].strip()
                if not text:
                    json_response(self, {"error": "Question text required"}, 400)
                    return
                if len(text) > MAX_QUESTION_LEN:
                    json_response(self, {"error": f"Question text must be {MAX_QUESTION_LEN} characters or fewer"}, 400)
                    return
            with PACKS_LOCK:
                packs = load_packs()
                for pack in packs:
                    if pack["id"] != pack_id:
                        continue
                    for q in pack.get("questions", []):
                        if q["id"] != qid:
                            continue
                        if text is not None:
                            q["text"] = text
                        if "rarity" in body:
                            q["rarity"] = body["rarity"]
                        if "category" in body:
                            q["category"] = body["category"]
                        save_packs(packs)
                        json_response(self, q)
                        return
            json_response(self, {"error": "Question not found"}, 404)
            return

        json_response(self, {"error": "Not found"}, 404)

    def do_DELETE(self):
        # ── Clear session (resume) ──
        if self.path == "/api/session":
            with PACKS_LOCK:
                clear_session()
            json_response(self, {"ok": True})
            return

        # ── Delete entire pack ──
        m = re.match(r"^/api/packs/(\d+)$", self.path)
        if m:
            pack_id = int(m.group(1))
            with PACKS_LOCK:
                packs = load_packs()
                packs = [p for p in packs if p["id"] != pack_id]
                save_packs(packs)
                prefix = f"p{pack_id}-"
                remove_marks(lambda k: k.startswith(prefix))
            json_response(self, {"ok": True})
            return

        # ── Delete a question from a pack ──
        m = re.match(r"^/api/packs/(\d+)/questions/(\d+)$", self.path)
        if m:
            pack_id, qid = int(m.group(1)), int(m.group(2))
            with PACKS_LOCK:
                packs = load_packs()
                for pack in packs:
                    if pack["id"] != pack_id:
                        continue
                    pack["questions"] = [q for q in pack["questions"] if q["id"] != qid]
                    save_packs(packs)
                    qkey = f"p{pack_id}-{qid}"
                    remove_marks(lambda k: k == qkey)
                    json_response(self, {"ok": True})
                    return
            json_response(self, {"error": "Pack not found"}, 404)
            return

        # ── Remove a mark ──
        if handle_mark_change(self, self.path, add=False):
            return

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