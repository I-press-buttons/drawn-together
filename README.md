# Couple Questions

A zero-dependency party card game: draw question cards of increasing rarity
and talk. Static frontend + Python stdlib server; user-created question
packs and favorites persist as JSON.

## Run locally

    python3 server.py
    # open http://localhost:8080

Data files (`question_packs.json`, `user_data.json`) are written next to
`server.py`, or to `$DATA_DIR` if set.

## Tests

    python3 -m unittest test_server.py

## Docker

Build and run (packs/favorites persist in a named volume):

    docker build -t couple-questions .
    docker run -d --name couple-questions -p 8080:8080 \
      -v couple-questions-data:/data couple-questions

Export the image to carry it to another machine:

    docker save couple-questions | gzip > couple-questions.tar.gz
    # on the target machine:
    docker load < couple-questions.tar.gz
