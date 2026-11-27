#!/usr/bin/env python3
"""Durable 8-800 capture + independent delivery. No network calls in AGI."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import sys
import time
import uuid
from datetime import datetime, timezone
from http.client import HTTPException
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler


def config(path):
    cfg = json.loads(Path(path).read_text(encoding="utf-8"))
    if not re.fullmatch(r"[a-z0-9-]{1,64}", cfg.get("node", "")):
        raise ValueError("Invalid node")
    routes = cfg.get("routes", {})
    if not routes or set(routes) - {"megafon", "mtt"} or any(
        not re.fullmatch(r"\+7800[0-9]{7}", v) for v in routes.values()
    ):
        raise ValueError("Invalid routes")
    return cfg


def connect(path):
    os.umask(0o077)
    Path(path).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    db = sqlite3.connect(path, timeout=2)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=FULL")
    db.execute("""CREATE TABLE IF NOT EXISTS queue(
        id TEXT PRIMARY KEY,payload TEXT NOT NULL,created REAL NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt REAL NOT NULL DEFAULT 0,lease_until REAL NOT NULL DEFAULT 0,
        lease TEXT NOT NULL DEFAULT '',last_error TEXT NOT NULL DEFAULT '',receipt TEXT)""")
    db.execute("CREATE INDEX IF NOT EXISTS queue_due ON queue(state,next_attempt,lease_until)")
    db.commit()
    return db


def event_id(event):
    return "AST800-" + hashlib.sha256((event["node"] + ":" + event["callId"]).encode()).hexdigest()[:32]


def caller(raw):
    # Withheld/unrecognised caller IDs remain an explicit review event.
    digits = re.sub(r"[+ ()-]", "", raw)
    if re.fullmatch(r"8[0-9]{10}", digits):
        digits = "7" + digits[1:]
    if re.fullmatch(r"[1-9][0-9]{7,14}", digits):
        return "+" + digits
    return ""


def capture(db, cfg, route, unique_id, phone):
    if route not in cfg["routes"] or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", unique_id):
        raise ValueError("Invalid call source")
    event = dict(v=1, node=cfg["node"], callId=unique_id, route=route,
                 phone=caller(phone), calledNumber=cfg["routes"][route])
    identity = event_id(event)
    with db:
        db.execute("BEGIN IMMEDIATE")
        previous = db.execute("SELECT payload FROM queue WHERE id=?", (identity,)).fetchone()
        if previous:
            saved = json.loads(previous["payload"])
            saved.pop("at")
            if saved != event:
                raise ValueError("Call identity conflict")
            return identity
        event["at"] = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        db.execute("INSERT INTO queue(id,payload,created) VALUES(?,?,?)",
                   (identity, json.dumps(event, separators=(",", ":")), time.time()))
    return identity


def agi(db, cfg, route, input_stream=sys.stdin, output_stream=sys.stdout):
    env = {}
    for line in input_stream:
        if not line.strip():
            break
        key, _, value = line.partition(":")
        env[key.strip()] = value.strip()
    capture(db, cfg, route, env.get("agi_uniqueid", ""), env.get("agi_callerid", ""))
    # The transaction has committed even if the caller hung up before this command.
    try:
        output_stream.write('SET VARIABLE CRM800_SAVED "1"\n')
        output_stream.flush()
        input_stream.readline()
    except BrokenPipeError:
        pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def validate_delivery(cfg):
    url = urlsplit(cfg.get("url", ""))
    local = url.hostname in ("127.0.0.1", "localhost", "::1")
    if (url.scheme != "https" and not (local and url.scheme == "http")) or not url.hostname or url.username or url.password or url.query or url.fragment or url.path != "/api/telephony/incoming-800":
        raise ValueError("Invalid receiver URL")
    if len(cfg.get("key", "").encode()) < 32:
        raise ValueError("Delivery key must contain at least 32 bytes")


def deliver(db, cfg):
    validate_delivery(cfg)
    now, lease = time.time(), uuid.uuid4().hex
    with db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("""SELECT * FROM queue WHERE state='pending' AND next_attempt<=?
                            AND lease_until<=? ORDER BY created,id LIMIT 1""", (now, now)).fetchone()
        if row is None:
            return False
        db.execute("UPDATE queue SET lease=?,lease_until=?,attempts=attempts+1 WHERE id=?",
                   (lease, now + 30, row["id"]))
    state, error, receipt = "pending", "transport_error", None
    request = Request(cfg["url"], data=row["payload"].encode(), method="POST",
                      headers={"Content-Type": "application/json", "x-crm-incoming-key": cfg["key"]})
    try:
        # Redirects cannot forward the separate PBX credential to another origin.
        with build_opener(ProxyHandler({}), NoRedirect()).open(request, timeout=3) as response:
            raw = response.read(4097)
            result = json.loads(raw) if len(raw) <= 4096 else None
            if (not isinstance(result, dict) or result.get("ok") is not True
                    or result.get("eventId") != row["id"]
                    or result.get("disposition") not in ("accepted", "review", "blocked")
                    or (result["disposition"] == "accepted" and not isinstance(result.get("requestId"), str))
                    or (result["disposition"] == "accepted" and not result["requestId"])):
                raise ValueError("Invalid receipt")
            state, error, receipt = result["disposition"], "", json.dumps(result, separators=(",", ":"))
    except HTTPError as exc:
        error = "http_" + str(exc.code)
        if exc.code in (400, 409, 413):
            state = "quarantine"
        exc.close()
    except ValueError:
        error = "invalid_receipt"
    except (OSError, HTTPException):
        pass
    delay = min(60, 2 ** min(row["attempts"], 6))
    with db:
        db.execute("""UPDATE queue SET state=?,last_error=?,receipt=?,next_attempt=?,lease_until=0,lease=''
                      WHERE id=? AND lease=?""", (state, error, receipt, time.time() + delay, row["id"], lease))
    return True


def status(db):
    counts = {row["state"]: row["n"] for row in db.execute("SELECT state,count(*) n FROM queue GROUP BY state")}
    oldest = db.execute("SELECT min(created) FROM queue WHERE state='pending'").fetchone()[0]
    return dict(counts=counts, oldestPendingSeconds=round(max(0, time.time() - oldest), 1) if oldest else 0,
                errors={r["last_error"]: r["n"] for r in db.execute("SELECT last_error,count(*) n FROM queue WHERE last_error<>'' GROUP BY last_error")})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("agi", "worker", "once", "status"))
    parser.add_argument("route", nargs="?")
    parser.add_argument("--config", default="/etc/asterisk/crm-incoming-800.json")
    parser.add_argument("--db", default="/var/lib/sm-crm-incoming-800/queue.sqlite")
    args = parser.parse_args()
    if args.mode == "agi" and hasattr(signal, "SIGHUP"):
        signal.signal(signal.SIGHUP, signal.SIG_IGN)
    with connect(args.db) as db:
        if args.mode == "status":
            print(json.dumps(status(db)))
            return
        cfg = config(args.config)
        if args.mode == "agi":
            agi(db, cfg, args.route)
        elif args.mode == "once":
            deliver(db, cfg)
        else:
            validate_delivery(cfg)
            while True:
                if not deliver(db, cfg):
                    time.sleep(0.5)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # No numbers, request body, URL or credential in shared logs.
        print("incoming800: " + type(exc).__name__, file=sys.stderr)
        sys.exit(1)
