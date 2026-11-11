#!/usr/bin/env python3
"""Convert legacy **Note:** blocks to fumadocs <Callout> components.

Callout is provided by defaultMdxComponents in fumadocs-ui, so no import is needed.

Usage:
  python3 scripts/content/convert-user-guide-callouts.py --check
  python3 scripts/content/convert-user-guide-callouts.py --dry-run
  python3 scripts/content/convert-user-guide-callouts.py --write
  python3 scripts/content/convert-user-guide-callouts.py --self-test
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TARGET = PROJECT_ROOT / "content/docs/zh/user-guide"

FRONTMATTER_RE = re.compile(r"\A---\r?\n[\s\S]*?\r?\n---\r?\n?")
NOTE_ONLY_RE = re.compile(r"^(\s*)\*\*Note:\*\*\s*$")
NOTE_SAME_LINE_RE = re.compile(r"^(\s*)\*\*Note:\*\*\s+(.+)$")
NOTE_TRAILING_RE = re.compile(r"^(\s*)(.+?)\*\*Note:\*\*\s*$")
CALLOUT_OPEN_RE = re.compile(r"^\s*<Callout\b")
LIST_ITEM_RE = re.compile(r"^\s+-\s")
ORDERED_STEP_RE = re.compile(r"^\s*\d+\.\s")


@dataclass
class ConvertStats:
    files_scanned: int = 0
    files_changed: int = 0
    callouts_created: int = 0


def split_frontmatter(text: str) -> tuple[str, str]:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return "", text
    return match.group(0), text[match.end() :]


def split_code_fences(text: str) -> list[tuple[str, bool]]:
    parts: list[tuple[str, bool]] = []
    pattern = re.compile(r"^(\s*```[^\n]*\n[\s\S]*?\n\s*```\s*)", re.MULTILINE)
    pos = 0
    for match in pattern.finditer(text):
        if match.start() > pos:
            parts.append((text[pos : match.start()], False))
        parts.append((match.group(1), True))
        pos = match.end()
    if pos < len(text):
        parts.append((text[pos:], False))
    return parts or [(text, False)]


def line_indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def callout_type(content: str) -> str:
    warning_markers = ("请谨慎", "谨慎操作", "不可恢复", "危险", "避免", "请勿")
    return "warning" if any(marker in content for marker in warning_markers) else "info"


def wrap_callout(indent: str, body_lines: list[str], stats: ConvertStats) -> list[str]:
    content = "\n".join(body_lines).strip()
    if not content:
        return body_lines
    ctype = callout_type(content)
    stats.callouts_created += 1
    return [
        f'{indent}<Callout type="{ctype}">',
        *body_lines,
        f"{indent}</Callout>",
    ]


def is_note_continuation(line: str, base_indent: int) -> bool:
    if not line.strip():
        return True
    indent = line_indent(line)
    if indent > base_indent:
        return True
    if indent < base_indent:
        return False
    if LIST_ITEM_RE.match(line) or ORDERED_STEP_RE.match(line):
        return True
    if re.match(r"^\s*\*\*[^*]+\*\*\s*$", line):
        return False
    if line.lstrip().startswith("#"):
        return False
    return False


def collect_note_block(lines: list[str], start: int, base_indent: int) -> tuple[list[str], int]:
    block: list[str] = []
    i = start
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            block.append(line)
            i += 1
            continue
        if not is_note_continuation(line, base_indent):
            break
        block.append(line)
        i += 1
    while block and not block[-1].strip():
        block.pop()
    return block, i


def convert_segment(segment: str, stats: ConvertStats) -> str:
    if "**Note:**" not in segment:
        return segment

    lines = segment.split("\n")
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]

        if CALLOUT_OPEN_RE.match(line):
            out.append(line)
            i += 1
            continue

        trailing = NOTE_TRAILING_RE.match(line)
        if trailing:
            indent, before = trailing.groups()
            if before.strip():
                out.append(f"{indent}{before.rstrip()}")
            block, i = collect_note_block(lines, i + 1, len(indent))
            out.extend(wrap_callout(indent, block, stats))
            continue

        same_line = NOTE_SAME_LINE_RE.match(line)
        if same_line:
            indent, content = same_line.groups()
            out.extend(wrap_callout(indent, [f"{indent}{content}"], stats))
            i += 1
            continue

        only = NOTE_ONLY_RE.match(line)
        if only:
            indent = only.group(1)
            block, i = collect_note_block(lines, i + 1, len(indent))
            out.extend(wrap_callout(indent, block, stats))
            continue

        if "**Note:**" in line:
            indent_match = re.match(r"^(\s*)", line)
            indent = indent_match.group(1) if indent_match else ""
            before, _, after = line.partition("**Note:**")
            if before.strip():
                out.append(before.rstrip())
            if after.strip():
                out.extend(wrap_callout(indent, [f"{indent}{after.strip()}"], stats))
            else:
                block, i = collect_note_block(lines, i + 1, len(indent))
                out.extend(wrap_callout(indent, block, stats))
                continue
            i += 1
            continue

        out.append(line)
        i += 1

    return "\n".join(out)


def convert_mdx_content(text: str, stats: ConvertStats | None = None) -> str:
    local_stats = stats or ConvertStats()
    frontmatter, body = split_frontmatter(text)
    chunks = split_code_fences(body)
    converted = []
    for chunk, is_code in chunks:
        converted.append(chunk if is_code else convert_segment(chunk, local_stats))
    result = frontmatter + "".join(converted)
    if text.endswith("\n") and not result.endswith("\n"):
        result += "\n"
    return result


def iter_mdx_files(target: Path) -> list[Path]:
    if target.is_file():
        return [target] if target.suffix == ".mdx" else []
    return sorted(target.rglob("*.mdx"))


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(PROJECT_ROOT))
    except ValueError:
        return str(path)


def process_path(target: Path, write: bool) -> ConvertStats:
    stats = ConvertStats()
    for path in iter_mdx_files(target):
        stats.files_scanned += 1
        original = path.read_text(encoding="utf-8")
        if "**Note:**" not in original:
            continue
        converted = convert_mdx_content(original, stats)
        if converted == original:
            continue
        stats.files_changed += 1
        if write:
            path.write_text(converted, encoding="utf-8")
    return stats


def scan_remaining(target: Path) -> list[str]:
    issues: list[str] = []
    for path in iter_mdx_files(target):
        text = path.read_text(encoding="utf-8")
        _, body = split_frontmatter(text)
        for chunk, is_code in split_code_fences(body):
            if is_code:
                continue
            for index, line in enumerate(chunk.split("\n"), 1):
                if "**Note:**" in line:
                    issues.append(f"{display_path(path)}: contains **Note:**")
                    break
    return issues


def run_self_tests() -> None:
    cases = [
        (
            "same line note",
            "        **Note:** 请提前添加备份存储。\n",
            '        <Callout type="info">\n        请提前添加备份存储。\n        </Callout>\n',
        ),
        (
            "standalone with list",
            "    **Note:**\n\n    -   item one\n    -   item two\n\n5.  next\n",
            None,
        ),
        (
            "trailing note with numbered list",
            "paragraph text。**Note:**\n\n1.  first\n2.  second\n\nNext section\n",
            "paragraph text。\n<Callout type=\"info\">\n\n1.  first\n2.  second\n</Callout>\nNext section\n",
        ),
        (
            "warning note",
            "**Note:** 删除集群请谨慎操作。\n",
            '<Callout type="warning">\n删除集群请谨慎操作。\n</Callout>\n',
        ),
        (
            "skip code fence",
            "```sh\n# **Note:** inside code\n```\n",
            "```sh\n# **Note:** inside code\n```\n",
        ),
        (
            "idempotent callout",
            '<Callout type="info">\ncontent\n</Callout>\n',
            '<Callout type="info">\ncontent\n</Callout>\n',
        ),
    ]

    for name, source, expected in cases:
        result = convert_mdx_content(source)
        if expected is not None and result != expected:
            raise AssertionError(
                f"self-test failed: {name}\nexpected:\n{expected!r}\ngot:\n{result!r}"
            )
        if "**Note:**" in result and "skip code fence" not in name:
            raise AssertionError(f"self-test left **Note:** in output: {name}")
        if convert_mdx_content(result) != result:
            raise AssertionError(f"self-test not idempotent: {name}")

    print("self-test: ok")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--target",
        type=Path,
        default=DEFAULT_TARGET,
        help=f"MDX file or directory (default: {DEFAULT_TARGET.relative_to(PROJECT_ROOT)})",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="report remaining **Note:** markers")
    mode.add_argument("--dry-run", action="store_true", help="show conversion stats without writing")
    mode.add_argument("--write", action="store_true", help="apply conversions in place")
    mode.add_argument("--self-test", action="store_true", help="run built-in tests")
    args = parser.parse_args(argv)

    if args.self_test:
        run_self_tests()
        return 0

    target = args.target if args.target.is_absolute() else PROJECT_ROOT / args.target
    if not target.exists():
        print(f"ERROR target not found: {target}", file=sys.stderr)
        return 2

    if args.check:
        issues = scan_remaining(target)
        if not issues:
            print(f"check: ok ({len(iter_mdx_files(target))} files)")
            return 0
        print(f"check: found {len(issues)} file(s) with **Note:**")
        for issue in issues[:30]:
            print(f"  - {issue}")
        if len(issues) > 30:
            print(f"  ... and {len(issues) - 30} more")
        return 1

    if not args.dry_run and not args.write:
        parser.error("specify one of --check, --dry-run, --write, or --self-test")

    stats = process_path(target, write=args.write)
    label = "write" if args.write else "dry-run"
    print(
        f"{label}: scanned {stats.files_scanned} file(s), "
        f"{'changed' if args.write else 'would change'} {stats.files_changed}, "
        f"callouts={stats.callouts_created}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
