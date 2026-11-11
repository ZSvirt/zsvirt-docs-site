#!/usr/bin/env python3
"""Remove redundant index nav entries from zh/user-guide meta.json files.

Fumadocs lists index.mdx as a sidebar child when it appears in meta.pages.
If the index title matches the folder title (or is a Cards-only nav hub), that
creates a duplicate entry like 资源监控 > 资源监控.

This script only touches:
  content/docs/zh/user-guide/**/meta.json

Usage:
  python3 scripts/content/dedupe-user-guide-nav-meta.py --check
  python3 scripts/content/dedupe-user-guide-nav-meta.py --dry-run
  python3 scripts/content/dedupe-user-guide-nav-meta.py --write
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
TARGET_ROOT = PROJECT_ROOT / "content/docs/zh/user-guide"

SKIP_META = {
    TARGET_ROOT / "meta.json",
    TARGET_ROOT / "getting-started" / "meta.json",
    TARGET_ROOT / "source-topics" / "meta.json",
}

TITLE_RE = re.compile(r'^title:\s*["\']?([^"\']+)["\']?\s*$', re.M)
PREFERRED_ORDER = {
    "overview": 0,
    "index": 1,
}


def discover_pages(meta_dir: Path) -> list[str]:
    pages: list[str] = []
    for child in sorted(meta_dir.iterdir()):
        if child.name in {"meta.json", "index.mdx"}:
            continue
        if child.suffix == ".mdx":
            pages.append(child.stem)
        elif child.is_dir() and not child.name.startswith("."):
            if (child / "meta.json").exists() or any(child.glob("*.mdx")):
                pages.append(child.name)
    pages.sort(key=lambda name: (PREFERRED_ORDER.get(name, 100), name))
    return pages


def is_redundant_index(meta_dir: Path, meta_title: str) -> bool:
    index_path = meta_dir / "index.mdx"
    if not index_path.exists():
        return False
    text = index_path.read_text(encoding="utf-8")
    match = TITLE_RE.search(text)
    index_title = match.group(1).strip() if match else ""
    body = text.split("---", 2)[-1] if text.count("---") >= 2 else text
    cards_nav = "<Cards>" in body and "## 本章内容" in body
    return meta_title == index_title or cards_nav


def transform_meta(meta_path: Path) -> tuple[dict | None, list[str]]:
    if meta_path in SKIP_META:
        return None, []

    data = json.loads(meta_path.read_text(encoding="utf-8"))
    pages = list(data.get("pages", []))
    if "index" not in pages:
        return None, []

    issues: list[str] = []
    meta_title = data.get("title", "")
    if not is_redundant_index(meta_path.parent, meta_title):
        issues.append("index kept: title differs from folder or not a Cards hub")
        return None, issues

    new_pages = [page for page in pages if page != "index"]
    if not new_pages:
        new_pages = discover_pages(meta_path.parent)

    changed = False
    if new_pages != pages:
        data["pages"] = new_pages
        changed = True

    if new_pages:
        if data.get("pagesIndex") != new_pages[0]:
            data["pagesIndex"] = new_pages[0]
            changed = True
    elif "pagesIndex" in data:
        del data["pagesIndex"]
        changed = True

    if not changed:
        return None, issues

    return data, issues


def iter_meta_files() -> list[Path]:
    return sorted(TARGET_ROOT.rglob("meta.json"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--write", action="store_true")
    args = parser.parse_args(argv)

    remaining: list[str] = []
    would_change = 0

    for meta_path in iter_meta_files():
        rel = meta_path.relative_to(PROJECT_ROOT)
        data, notes = transform_meta(meta_path)
        current = json.loads(meta_path.read_text(encoding="utf-8"))
        pages = current.get("pages", [])
        if meta_path not in SKIP_META and "index" in pages:
            if is_redundant_index(meta_path.parent, current.get("title", "")):
                remaining.append(f"{rel}: still lists index in pages")

        if data is None:
            continue
        would_change += 1
        if args.write:
            meta_path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        elif args.dry_run:
            print(f"would update {rel}")

    if args.check:
        if remaining:
            print(f"check: found {len(remaining)} issue(s)")
            for item in remaining[:30]:
                print(f"  - {item}")
            return 1
        print(f"check: ok ({len(iter_meta_files())} meta.json under zh/user-guide)")
        return 0

    verb = "write" if args.write else "dry-run"
    print(f"{verb}: {would_change} meta.json file(s) under zh/user-guide")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
