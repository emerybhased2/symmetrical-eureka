#!/usr/bin/env python3
# ruff: noqa: UP032
"""Fetch BTD6 maps and their difficulty ratings from public GitHub repositories.

Three independently maintained sources are consulted, each a plain JSON file on
GitHub served via raw.githubusercontent.com (no API key required):

    superbot    menno420/superbot      disbot/data/btd6/maps.json
    blinkywink  blinkywink/...         src/data/maps.json
    anrar4      ANRAR4/AutoBTD6        maps.json

The script fetches each file, normalises it to a common schema
    {"id", "name", "difficulty", "sources"}
and merges entries by canonical id (slug of the name). Difficulty disagreements
between sources are preserved as a dict on `difficulty` and reported.

Output formats: json (default), csv, table. Stdin and extra args aren't used,
so running without options prints the merged JSON to stdout.

Standard library only (urllib). Run with python3 -I for safety when invoked
from a scratchpad directory: this script itself does no `import` of local files.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import signal
import ssl
import sys
import urllib.error
import urllib.request

# Behave like a well-mannered Unix CLI when stdout is piped to `head`, etc:
# let SIGPIPE kill us silently instead of Python printing a BrokenPipeError
# during interpreter shutdown. Windows has no SIGPIPE; the attribute is absent.
try:
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)
except (AttributeError, ValueError):
    pass
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Source:
    key: str
    url: str
    description: str
    parse: Callable[[Any], list[dict[str, Any]]]


def _slug(name: str) -> str:
    """Canonical id: lowercase, non-alphanum collapsed to single underscore."""
    s = re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")
    return s


def _norm_difficulty(value: Any) -> str:
    """Capitalise the first letter: 'beginner' -> 'Beginner'. Keep Unknown."""
    if not value:
        return "Unknown"
    s = str(value).strip()
    if not s:
        return "Unknown"
    return s[:1].upper() + s[1:].lower()


def _parse_superbot(data: Any) -> list[dict[str, Any]]:
    """menno420/superbot — {data_version, game_version, source, maps: [...]}."""
    maps = data.get("maps", []) if isinstance(data, dict) else []
    out: list[dict[str, Any]] = []
    for m in maps:
        if not isinstance(m, dict):
            continue
        name = m.get("canonical") or m.get("name") or m.get("id")
        if not name:
            continue
        out.append(
            {
                "id": _slug(name),
                "name": name,
                "difficulty": _norm_difficulty(m.get("difficulty")),
                "_extra": {
                    k: v
                    for k, v in m.items()
                    if k in ("aliases", "description", "has_water", "lines_of_sight_notes")
                },
            }
        )
    return out


def _parse_blinkywink(data: Any) -> list[dict[str, Any]]:
    """blinkywink/blinkywink.github.io — list of {id, name, difficulty, image, ...}."""
    if not isinstance(data, list):
        return []
    out: list[dict[str, Any]] = []
    for m in data:
        if not isinstance(m, dict):
            continue
        name = m.get("name") or m.get("id")
        if not name:
            continue
        out.append(
            {
                "id": _slug(name),
                "name": name,
                "difficulty": _norm_difficulty(m.get("difficulty")),
                "_extra": {k: v for k, v in m.items() if k in ("image",)},
            }
        )
    return out


def _parse_anrar4(data: Any) -> list[dict[str, Any]]:
    """ANRAR4/AutoBTD6 — {<id>: {category, name, page, pos}}."""
    if not isinstance(data, dict):
        return []
    out: list[dict[str, Any]] = []
    for key, val in data.items():
        if not isinstance(val, dict):
            continue
        name = val.get("name") or key.replace("_", " ").title()
        out.append(
            {
                "id": _slug(name),
                "name": name,
                "difficulty": _norm_difficulty(val.get("category")),
                "_extra": {k: v for k, v in val.items() if k in ("page", "pos")},
            }
        )
    return out


SOURCES: list[Source] = [
    Source(
        key="superbot",
        url="https://raw.githubusercontent.com/menno420/superbot/main/disbot/data/btd6/maps.json",
        description="menno420/superbot (versioned, with LoS notes)",
        parse=_parse_superbot,
    ),
    Source(
        key="blinkywink",
        url="https://raw.githubusercontent.com/blinkywink/blinkywink.github.io/main/src/data/maps.json",
        description="blinkywink.github.io (with map thumbnail URLs)",
        parse=_parse_blinkywink,
    ),
    Source(
        key="anrar4",
        url="https://raw.githubusercontent.com/ANRAR4/AutoBTD6/main/maps.json",
        description="ANRAR4/AutoBTD6 (compact categories)",
        parse=_parse_anrar4,
    ),
]


# ---------------------------------------------------------------------------
# Fetch & merge
# ---------------------------------------------------------------------------


def fetch_json(url: str, timeout: float = 30.0) -> Any:
    """Fetch a URL and parse JSON. Uses the system proxy env (HTTPS_PROXY) if set."""
    # We deliberately do not pass custom User-Agent headers naming the user.
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        raw = resp.read()
    return json.loads(raw.decode("utf-8"))


@dataclass
class Merged:
    id: str
    name: str
    difficulty: str | dict[str, str]  # str when all sources agree; dict {source: diff} otherwise
    sources: list[str] = field(default_factory=list)
    extra: dict[str, dict[str, Any]] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "id": self.id,
            "name": self.name,
            "difficulty": self.difficulty,
            "sources": self.sources,
        }
        if self.extra:
            d["extra"] = self.extra
        return d


def merge(per_source: dict[str, list[dict[str, Any]]]) -> list[Merged]:
    """Merge entries by canonical id; preserve name from the first seen source."""
    by_id: dict[str, Merged] = {}
    diffs: dict[str, dict[str, str]] = {}
    names: dict[str, str] = {}
    extras: dict[str, dict[str, dict[str, Any]]] = {}
    source_order: dict[str, list[str]] = {}
    for src_key, entries in per_source.items():
        for e in entries:
            i = e["id"]
            diffs.setdefault(i, {})[src_key] = e["difficulty"]
            names.setdefault(i, e["name"])
            if e.get("_extra"):
                extras.setdefault(i, {})[src_key] = e["_extra"]
            source_order.setdefault(i, []).append(src_key)

    for i, dmap in diffs.items():
        diff_values = {v for v in dmap.values() if v and v != "Unknown"}
        if len(diff_values) <= 1:
            diff_out: str | dict[str, str] = next(iter(diff_values), "Unknown")
        else:
            diff_out = dmap  # keep per-source split when they disagree
        by_id[i] = Merged(
            id=i,
            name=names[i],
            difficulty=diff_out,
            sources=source_order[i],
            extra=extras.get(i, {}),
        )

    return sorted(by_id.values(), key=lambda m: (_difficulty_order(m.difficulty), m.name.lower()))


_DIFF_ORDER = {"Beginner": 0, "Intermediate": 1, "Advanced": 2, "Expert": 3, "Unknown": 4}


def _difficulty_order(d: str | dict[str, str]) -> int:
    if isinstance(d, dict):
        # When disagreeing, sort by the lowest-rated interpretation
        return min(_DIFF_ORDER.get(_norm_difficulty(v), 4) for v in d.values())
    return _DIFF_ORDER.get(_norm_difficulty(d), 4)


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------


def _difficulty_display(d: str | dict[str, str]) -> str:
    if isinstance(d, dict):
        joined = ", ".join(f"{k}={v}" for k, v in sorted(d.items()))
        return f"conflict({joined})"
    return d


def render_table(merged: list[Merged], sources_used: list[str]) -> str:
    """Pretty ASCII table."""
    rows: list[tuple[str, str, str, str]] = [
        ("id", "name", "difficulty", "sources"),
    ]
    for m in merged:
        rows.append(
            (
                m.id,
                m.name,
                _difficulty_display(m.difficulty),
                ",".join(s for s in sources_used if s in m.sources),
            )
        )
    widths = [max(len(r[c]) for r in rows) for c in range(4)]
    sep = "-+-".join("-" * w for w in widths)
    out = [" | ".join(rows[0][c].ljust(widths[c]) for c in range(4)), sep]
    for r in rows[1:]:
        out.append(" | ".join(r[c].ljust(widths[c]) for c in range(4)))
    return "\n".join(out)


def render_csv(merged: list[Merged]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "name", "difficulty", "sources", "conflict"])
    for m in merged:
        d = _difficulty_display(m.difficulty)
        conflict = "1" if isinstance(m.difficulty, dict) else "0"
        w.writerow([m.id, m.name, d, ";".join(m.sources), conflict])
    return buf.getvalue()


def render_json(
    merged: list[Merged],
    sources_meta: list[dict[str, Any]],
    include_raw: bool,
    raw: dict[str, Any],
) -> str:
    out: dict[str, Any] = {
        "schema_version": 1,
        "sources": sources_meta,
        "count": len(merged),
        "maps": [m.as_dict() for m in merged],
    }
    if include_raw:
        out["raw"] = raw
    return json.dumps(out, indent=2, sort_keys=False)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def _pick_sources(keys: Iterable[str] | None) -> list[Source]:
    if not keys:
        return list(SOURCES)
    want = {k.lower() for k in keys}
    unknown = want - {s.key for s in SOURCES}
    if unknown:
        raise SystemExit(f"Unknown source(s): {sorted(unknown)}. "
                         f"Available: {[s.key for s in SOURCES]}")
    return [s for s in SOURCES if s.key in want]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Fetch BTD6 maps and their difficulty from public GitHub repositories.",
        epilog="Sources:\n  " + "\n  ".join(f"{s.key:12s} {s.description}" for s in SOURCES),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--source", action="append", metavar="NAME",
                        help="Fetch only this source (repeat to pick several). "
                             "Default: all.")
    parser.add_argument("--format", choices=["json", "csv", "table"], default="json",
                        help="Output format (default: json).")
    parser.add_argument("--output", "-o", metavar="FILE",
                        help="Write to FILE instead of stdout.")
    parser.add_argument("--conflicts-only", action="store_true",
                        help="Only emit maps where sources disagree on difficulty.")
    parser.add_argument("--include-raw", action="store_true",
                        help="Include each source's raw JSON in JSON output (large).")
    parser.add_argument("--list-sources", action="store_true",
                        help="List configured sources and exit.")
    parser.add_argument("--timeout", type=float, default=30.0,
                        help="Per-source fetch timeout in seconds (default: 30).")
    args = parser.parse_args(argv)

    if args.list_sources:
        for s in SOURCES:
            print(f"{s.key:12s} {s.description}\n             {s.url}")
        return 0

    sources = _pick_sources(args.source)

    per_source: dict[str, list[dict[str, Any]]] = {}
    sources_meta: list[dict[str, Any]] = []
    raw_blobs: dict[str, Any] = {}
    errors: list[str] = []

    for s in sources:
        try:
            raw = fetch_json(s.url, timeout=args.timeout)
        except urllib.error.URLError as e:
            errors.append(f"{s.key}: {e}")
            sources_meta.append({"key": s.key, "url": s.url, "ok": False, "error": str(e)})
            continue
        except json.JSONDecodeError as e:
            errors.append(f"{s.key}: invalid JSON: {e}")
            sources_meta.append({"key": s.key, "url": s.url, "ok": False, "error": str(e)})
            continue
        entries = s.parse(raw)
        per_source[s.key] = entries
        raw_blobs[s.key] = raw
        sources_meta.append(
            {
                "key": s.key,
                "url": s.url,
                "description": s.description,
                "ok": True,
                "count": len(entries),
            }
        )

    merged = merge(per_source)
    if args.conflicts_only:
        merged = [m for m in merged if isinstance(m.difficulty, dict)]

    used_keys = [s.key for s in sources if s.key in per_source]

    if args.format == "json":
        payload = render_json(merged, sources_meta, args.include_raw, raw_blobs)
    elif args.format == "csv":
        payload = render_csv(merged)
    else:
        payload = render_table(merged, used_keys)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(payload)
            if not payload.endswith("\n"):
                f.write("\n")
    else:
        sys.stdout.write(payload)
        if not payload.endswith("\n"):
            sys.stdout.write("\n")

    for e in errors:
        print(f"warning: {e}", file=sys.stderr)

    return 0 if per_source else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BrokenPipeError:
        # Downstream pipe (e.g. `| head`) closed early. Mute Python's teardown warning.
        try:
            sys.stdout.close()
        except Exception:
            pass
        try:
            sys.stderr.close()
        except Exception:
            pass
        raise SystemExit(0)
    except KeyboardInterrupt:
        raise SystemExit(130)
