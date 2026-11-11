#!/usr/bin/env python3
import argparse
import re
import sys
from pathlib import Path

TARGET_ROOT = Path(__file__).resolve().parents[1] / "content/docs/en/terraform-for-zsvirt"


def display_target_path(path: Path) -> Path:
    try:
        return path.relative_to(TARGET_ROOT)
    except ValueError:
        return path


def parse_frontmatter(content: str):
    match = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n([\s\S]*)$", content, re.DOTALL)
    if not match:
        return "", "", content

    fm, body = match.group(1), match.group(2)
    title = ""
    page_title_match = re.search(r'page_title:\s*"([^"]+)"', fm)
    if page_title_match:
        title = (
            page_title_match.group(1)
            .replace(" Resource - zsphere", "")
            .replace(" Data Source - zsphere", "")
            .replace("ZStack Provider", "ZSphere Provider")
        )

    description = ""
    block_desc_match = re.search(r"description:\s*\|-\r?\n([\s\S]*?)(?:\r?\n[a-z_]+:|$)", fm)
    if block_desc_match:
        description = " ".join(
            line.strip()
            for line in block_desc_match.group(1).splitlines()
            if line.strip()
        )
    else:
        inline_desc_match = re.search(r'description:\s*"([^"]*)"', fm, re.DOTALL)
        if inline_desc_match:
            description = inline_desc_match.group(1)

    if not title:
        heading_match = re.search(r"^#\s+(.+)$", body, re.MULTILINE)
        if heading_match:
            title = re.sub(r"\s+\((Resource|Data Source)\)$", "", heading_match.group(1))

    return title, description, body.lstrip("\n")


def escape_mdx_outside_code_fences(text: str) -> str:
    parts = re.split(r"(```[\s\S]*?```)", text)

    def escape_segment(segment: str) -> str:
        def replacer(match: re.Match) -> str:
            start = match.start()
            before = segment[start - 1] if start > 0 else ""
            after = segment[match.end()] if match.end() < len(segment) else ""
            if before == "`" or after == "`":
                return match.group(0)
            return f"\\{{{match.group(1)}\\}}"

        return re.sub(r"\{([^{}\n]+)\}", replacer, segment)

    return "".join(escape_segment(part) if index % 2 == 0 else part for index, part in enumerate(parts))


def sanitize_mdx_body(body: str) -> str:
    body = re.sub(r"<!--.*?-->\s*", "", body, flags=re.DOTALL)
    return escape_mdx_outside_code_fences(body)


def to_mdx(title: str, description: str, body: str) -> str:
    lines = ["---", f"title: '{title.replace(chr(39), chr(39) * 2)}'"]
    if description:
        lines.append(f"description: '{description.replace(chr(39), chr(39) * 2)}'")
    lines.extend(["---", "", sanitize_mdx_body(body)])
    return "\n".join(lines).rstrip() + "\n"


def convert_file(source_path: Path, target_path: Path, *, check: bool) -> bool:
    content = source_path.read_text(encoding="utf-8")
    title, description, body = parse_frontmatter(content)
    expected = to_mdx(title, description, body)
    current = target_path.read_text(encoding="utf-8") if target_path.exists() else None
    if current == expected:
        return False
    if check:
        print(f"outdated: {display_target_path(target_path)}")
        return True
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(expected, encoding="utf-8")
    print(f"updated: {display_target_path(target_path)}")
    return True


def convert_directory(source_dir: Path, target_dir: Path, *, check: bool) -> int:
    changed = 0
    source_files = sorted(source_dir.glob("*.md"))
    expected_targets = {target_dir / f"{entry.stem}.mdx" for entry in source_files}
    for entry in source_files:
        changed += convert_file(
            entry,
            target_dir / f"{entry.stem}.mdx",
            check=check,
        )
    for target_path in sorted(target_dir.glob("*.mdx")):
        if target_path.name == "index.mdx" or target_path in expected_targets:
            continue
        changed += 1
        relative_path = display_target_path(target_path)
        if check:
            print(f"orphaned: {relative_path}")
            continue
        target_path.unlink()
        print(f"removed: {relative_path}")
    return changed


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync Terraform provider reference docs.")
    parser.add_argument("--source-root", type=Path, required=True,
                        help="Path to the Terraform provider checkout containing docs/.")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Report generated files that differ without writing them.",
    )
    args = parser.parse_args()
    source_root = args.source_root.resolve()
    for source_path in (source_root / "docs/index.md", source_root / "docs/resources", source_root / "docs/data-sources"):
        if not source_path.exists():
            parser.error(f"Missing provider documentation: {source_path}")

    changed = int(
        convert_file(
            source_root / "docs/index.md",
            TARGET_ROOT / "provider-configuration.mdx",
            check=args.check,
        )
    )
    changed += convert_directory(
        source_root / "docs/resources",
        TARGET_ROOT / "resources",
        check=args.check,
    )
    changed += convert_directory(
        source_root / "docs/data-sources",
        TARGET_ROOT / "data-sources",
        check=args.check,
    )
    action = "outdated" if args.check else "updated"
    print(f"{action}: {changed} file(s)")
    return 1 if args.check and changed else 0


if __name__ == "__main__":
    sys.exit(main())
