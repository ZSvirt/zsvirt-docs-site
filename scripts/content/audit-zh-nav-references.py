#!/usr/bin/env python3
"""Find zh doc pages that are linked but not in the left sidebar navigation."""

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ZH_ROOT = PROJECT_ROOT / "content/docs/zh"

LINK_RE = re.compile(
    r"""(?:href|]\()\s*["']?(/(?:en/)?docs/[^"'\s)#?]+)""",
    re.IGNORECASE,
)
TITLE_RE = re.compile(r'^title:\s*["\']?([^"\']+)["\']?\s*$', re.M)


def slug_from_path(path: Path) -> str:
    rel = path.relative_to(ZH_ROOT).as_posix()
    if rel.endswith("/index.mdx"):
        return rel[: -len("/index.mdx")]
    if rel.endswith(".mdx"):
        return rel[: -len(".mdx")]
    raise ValueError(rel)


def normalize_href(href: str) -> str:
    href = href.split("#", 1)[0].rstrip("/")
    if href.startswith("/en/docs/"):
        href = href[len("/en/") :]
    if href.startswith("/docs/"):
        href = href[len("/docs/") :]
    return href


def read_title(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    match = TITLE_RE.search(text)
    return match.group(1).strip() if match else path.stem


def collect_all_pages() -> dict[str, Path]:
    pages: dict[str, Path] = {}
    for path in ZH_ROOT.rglob("*.mdx"):
        pages[slug_from_path(path)] = path
    return pages


def collect_nav_slugs() -> set[str]:
    nav: set[str] = set()

    def walk(dir_path: Path, rel: str) -> None:
        meta_path = dir_path / "meta.json"
        if not meta_path.exists():
            return

        data = json.loads(meta_path.read_text(encoding="utf-8"))
        pages = data.get("pages", [])
        pages_index = data.get("pagesIndex", "index")

        index_slug = f"{rel}/{pages_index}" if rel else pages_index
        nav.add(index_slug)

        for page in pages:
            if page == pages_index:
                continue
            child_rel = f"{rel}/{page}" if rel else page
            child_path = dir_path / page
            nav.add(child_rel)
            if child_path.is_dir():
                walk(child_path, child_rel)

    # user-guide is the primary sidebar tree
    walk(ZH_ROOT / "user-guide", "user-guide")

    # top-level zh docs (no meta.json) are auto-listed at /docs root
    for path in ZH_ROOT.glob("*.mdx"):
        nav.add(slug_from_path(path))

    return nav


def collect_references(all_pages: dict[str, Path]) -> dict[str, list[tuple[str, str]]]:
    refs: dict[str, list[tuple[str, str]]] = defaultdict(list)

    for source_slug, path in all_pages.items():
        text = path.read_text(encoding="utf-8")
        for match in LINK_RE.finditer(text):
            target = normalize_href(match.group(1))
            if target in all_pages:
                refs[target].append((source_slug, match.group(1)))

    return refs


def main() -> None:
    all_pages = collect_all_pages()
    nav_slugs = collect_nav_slugs()
    refs = collect_references(all_pages)

    missing = []
    for target_slug, sources in sorted(refs.items()):
        if target_slug in nav_slugs:
            continue
        path = all_pages[target_slug]
        title = read_title(path)
        missing.append(
            {
                "slug": target_slug,
                "title": title,
                "url": f"/docs/{target_slug}",
                "referenced_by": sorted({s for s, _ in sources}),
                "ref_count": len(sources),
            }
        )

    # Group by top-level section for readability
    by_section: dict[str, list[dict]] = defaultdict(list)
    for item in missing:
        parts = item["slug"].split("/")
        section = parts[1] if len(parts) > 1 and parts[0] == "user-guide" else parts[0]
        by_section[section].append(item)

    print(f"Total zh pages: {len(all_pages)}")
    print(f"Pages in sidebar nav: {len(nav_slugs)}")
    print(f"Referenced pages not in nav: {len(missing)}\n")

    for section in sorted(by_section):
        items = by_section[section]
        print(f"## {section} ({len(items)})")
        print()
        for item in items:
            print(f"- **{item['title']}**")
            print(f"  - URL: `{item['url']}`")
            print(f"  - File: `content/docs/zh/{item['slug']}.mdx`")
            print(f"  - Referenced {item['ref_count']} time(s)")
            for src in item["referenced_by"][:5]:
                print(f"    - from `{src}`")
            if len(item["referenced_by"]) > 5:
                print(f"    - ... and {len(item['referenced_by']) - 5} more")
            print()


if __name__ == "__main__":
    main()
