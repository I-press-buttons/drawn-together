# Gameplay Wave — Design

## Context

Couple Questions is a zero-dependency party card game: static frontend (`index.html`, `style.css`, `app.js`, `questions.json`) served by a stdlib Python server (`server.py`) with a JSON CRUD API for user-created question packs (`question_packs.json`), covered by 18 stdlib unittests. This wave adds the product features chosen after the code-health pass: favorites ("greatest hits"), retire-question, a warmer game-over moment, a legendary/mythic reveal, question editing, pack export/import, and an exportable Docker image.

Approved approach: **stable question identity + separate user-state file** (approach A). Storage is server-side (user's explicit choice) so both partners' devices share favorites/retired state.

## Non-goals

- Portability fork (static hosting vs LAN QR) — separate future cycle.
- Accessibility audit — separate future cycle (new UI must still follow PRODUCT.md basics: keyboard operable, visible focus, color never sole differentiator, `prefers-reduced-motion` respected).
- Editing the 108 base questions.
- No new dependencies, no build step, no frameworks — unchanged constraint.

## Design

### 1. Data model & identity

- Every entry in `questions.json` gains a permanent `"id"`: `"b1"`…`"b108"`, assigned once in file order and never renumbered.
- A pack question is referenced by composite key `p<packId>-<qid>` (e.g. `p3-2`).
- New `user_data.json` (same directory as `question_packs.json`):
  ```json
  { "favorites": ["b12", "p3-2"], "retired": ["b40"] }
  ```
- Valid mark key format: `^(b\d+|p\d+-\d+)$`.

### 2. Server (`server.py`)

- **`DATA_DIR` env var** (default: script directory). Both `question_packs.json` and `user_data.json` resolve against it. Missing files mean empty state.
- **Marks API** (all responses JSON; mutations serialized by the existing lock discipline — one module lock is sufficient):
  - `GET /api/marks` → `{"favorites": [...], "retired": [...]}`
  - `POST /api/marks/favorites/<qkey>` → add (idempotent), returns updated lists.
  - `DELETE /api/marks/favorites/<qkey>` → remove (idempotent), returns updated lists.
  - Same for `/api/marks/retired/<qkey>`.
  - Malformed `<qkey>` → 400 `{"error": ...}`; unknown-but-well-formed keys are accepted (server does not cross-check existence; the client only sends keys it rendered).
- **Question edit**: `PUT /api/packs/<id>/questions/<qid>` with any of `{"text", "rarity", "category"}`. Text validated: non-empty after strip, ≤ 300 chars. 404 for unknown pack/question. Returns the updated question.
- **Mark cleanup**: deleting a question removes `p<packId>-<qid>` from both lists; deleting a pack removes every `p<packId>-*` key.
- Existing behavior, error shapes (`{"error": ...}`), 1 MB body cap, and length limits unchanged.

### 3. Frontend — favorites & retire

- Card face: a heart toggle (favorite) and a quiet "never show again" control (retire). Retire deals the next card and shows a toast with **Undo**.
- Deck building excludes retired questions.
- Pack manager gains two sections:
  - **Greatest Hits**: favorited questions (text + rarity + un-heart button) and a **Play favorites round** button that resets the game with a favorites-only deck (retired excluded even here if a favorite was later retired).
  - **Retired**: retired questions with per-row **Restore**.
- Marks load at boot alongside packs (`GET /api/marks`); toggles call the API optimistically and re-sync on failure.

### 4. Game-over moment

- Session stats tracked in memory: questions answered, skipped, rarest answered (by rarity rank), favorites hearted this session.
- Game-over screen copy (warm, no badges/confetti):
  - "You made it through **N** questions together."
  - If any answered: "Rarest catch: *[question text]* (Mythic)."
  - If any hearts: "You saved K to your greatest hits."
  - Single primary action: **One more round**.

### 5. Rarity reveal

- Legendary and mythic draws: one rarity-colored glow-and-settle animation on card entrance, < 1 s, no sound.
- `prefers-reduced-motion: reduce` → no animation; static rarity-colored glow border instead.

### 6. Question editing (packs only)

- Each pack-question row gets an edit (pencil) button that swaps the row to an inline form: text input (maxlength 300), rarity select, category select, Save / Cancel.
- Save calls the new PUT endpoint, re-renders; Cancel restores the row. Marks are unaffected (keys are id-based).

### 7. Pack export / import

- **Export packs** (pack manager footer): client-side download of `couple-questions-packs.json` — array of `{name, questions: [{text, rarity, category}]}`. No ids, no marks (marks are personal; packs are shareable).
- **Import packs**: file input; client validates shape (array; each item has string `name`; `questions` array of objects with string `text`), then replays through the existing `POST /api/packs` + `POST /api/packs/<id>/questions` APIs so the server assigns fresh ids. Invalid file → error toast, nothing imported. Oversized/overlong fields are rejected by existing server validation; the client surfaces the first error and stops.

### 8. Exportable Docker

- `Dockerfile`: `FROM python:3.12-slim`, copy app files, `ENV DATA_DIR=/data`, `VOLUME /data`, `EXPOSE 8080`, `CMD ["python3", "server.py"]`. No package installs.
- `.dockerignore`: `.git`, `.claude`, `.impeccable`, `docs`, `test_server.py`, data files.
- `README.md` section: build (`docker build -t couple-questions .`), run (`docker run -d -p 8080:8080 -v couple-questions-data:/data couple-questions`), and export/load (`docker save couple-questions | gzip > couple-questions.tar.gz`, `docker load < ...`).

### 9. Error handling

- New endpoints reuse the `{"error": ...}` shape: 400 malformed mark key / invalid edit fields, 404 unknown pack/question, 413 oversized body (inherited).
- Frontend API failures: error toast; optimistic mark toggles revert on failure.

### 10. Testing

- `test_server.py` additions: marks CRUD (add/remove/list/idempotency, malformed key 400), question edit (success, partial update, 404s, over-length 400), mark cleanup on question and pack delete, `DATA_DIR` resolution.
- All existing 18 tests stay green. `python3 -m unittest test_server.py` remains the only test command.
- Frontend: manual verification checklist (hearts, retire+undo, favorites round, edit, export/import round-trip, game-over stats, reveal animation incl. reduced-motion, Docker build/run/save/load).
