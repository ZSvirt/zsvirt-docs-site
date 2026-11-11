#!/usr/bin/env python3
"""Fix common Markdown formatting issues in migrated user-guide MDX files.

These issues typically originate from DITA/HTML export (user-guide-md) and break
rendering in MDX (fumadocs). The script is idempotent and preserves frontmatter,
code fences, and intentional HTML entities such as &lt;&gt; in character lists.

Usage:
  python3 scripts/content/fix-user-guide-mdx.py --check
  python3 scripts/content/fix-user-guide-mdx.py --dry-run
  python3 scripts/content/fix-user-guide-mdx.py --write
  python3 scripts/content/fix-user-guide-mdx.py --self-test
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TARGET = PROJECT_ROOT / "content/docs/zh/user-guide"

FRONTMATTER_RE = re.compile(r"\A---\r?\n[\s\S]*?\r?\n---\r?\n?")
SECTION_HEADER_RE = re.compile(r"^\s{4}\*\*[^*]+\*\*\s*$")
LINK_LINE_RE = re.compile(r"^(\s*-\s+\*\*\[.+?\]\(.+?\)\*\*)\s*$")
ORDERED_STEP_RE = re.compile(r"^(\s*)\d+\.\s")
LIST_ITEM_RE = re.compile(r"^\s+-\s")
NAV_GT_RE = re.compile(r" &gt; ")
NAV_BOLD_GT_RE = re.compile(r"\*\* &gt; \*\*")
PRIORITY_GT_RE = re.compile(r"([\u4e00-\u9fff\w])&gt;([\u4e00-\u9fff\w])")
PROSE_LINE_RE = re.compile(r"^\s{4,}\S")


@dataclass
class FixStats:
    files_scanned: int = 0
    files_changed: int = 0
    navigation_gt: int = 0
    navigation_bold_gt: int = 0
    priority_gt: int = 0
    section_header_blank: int = 0
    ordered_step_blank: int = 0
    related_link_indent: int = 0
    prose_outdent_blank: int = 0

    def merge(self, other: FixStats) -> None:
        for key in self.__dataclass_fields__:
            setattr(self, key, getattr(self, key) + getattr(other, key))


@dataclass
class IssueReport:
    issues: list[str] = field(default_factory=list)

    def add(self, message: str) -> None:
        self.issues.append(message)


def split_frontmatter(text: str) -> tuple[str, str]:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return "", text
    return match.group(0), text[match.end() :]


def split_code_fences(text: str) -> list[tuple[str, bool]]:
    """Split body into (segment, is_code_fence) chunks."""
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


def fix_navigation_entities(segment: str, stats: FixStats) -> str:
    def nav_sub(match: re.Match[str]) -> str:
        stats.navigation_gt += 1
        return " > "

    def bold_sub(match: re.Match[str]) -> str:
        stats.navigation_bold_gt += 1
        return "** > **"

    def priority_sub(match: re.Match[str]) -> str:
        stats.priority_gt += 1
        return f"{match.group(1)}>{match.group(2)}"

    segment = NAV_GT_RE.sub(nav_sub, segment)
    segment = NAV_BOLD_GT_RE.sub(bold_sub, segment)
    segment = PRIORITY_GT_RE.sub(priority_sub, segment)
    return segment


def is_related_link_description(link_line: str, next_line: str) -> bool:
    if not LINK_LINE_RE.match(link_line.rstrip()):
        return False
    if not next_line.strip():
        return False
    if next_line.startswith("    "):
        return False
    if LIST_ITEM_RE.match(next_line):
        return False
    if ORDERED_STEP_RE.match(next_line):
        return False
    if next_line.lstrip().startswith(("#", "**Parent")):
        return False
    if LINK_LINE_RE.match(next_line.rstrip()):
        return False
    return True


def is_outdented_prose_after_list(line: str, prev: str) -> bool:
    if not line.strip() or not prev.strip():
        return False
    if line.lstrip().startswith("```"):
        return False
    if LIST_ITEM_RE.match(line) or ORDERED_STEP_RE.match(line):
        return False
    if SECTION_HEADER_RE.match(line):
        return False
    if line.lstrip().startswith("**Note"):
        return False
    if not PROSE_LINE_RE.match(line):
        return False
    if not LIST_ITEM_RE.match(prev):
        return False
    prev_indent = len(prev) - len(prev.lstrip(" "))
    curr_indent = len(line) - len(line.lstrip(" "))
    return prev_indent > curr_indent >= 4


def iter_scannable_body_lines(text: str) -> list[tuple[int, str, str]]:
    """Yield (1-based line number, line, previous scannable line) for issue scans."""
    frontmatter, body = split_frontmatter(text)
    start_line = frontmatter.count("\n") + 1 if frontmatter else 1
    results: list[tuple[int, str, str]] = []
    prev = ""
    for chunk, is_code in split_code_fences(body):
        if is_code:
            start_line += chunk.count("\n")
            continue
        for line in chunk.split("\n"):
            results.append((start_line, line, prev))
            prev = line
            start_line += 1
    return results


def fix_markdown_body(segment: str, stats: FixStats) -> str:
    lines = segment.split("\n")
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        prev = out[-1] if out else ""

        if (
            SECTION_HEADER_RE.match(line)
            and prev
            and LIST_ITEM_RE.match(prev)
            and prev.strip()
        ):
            out.append("")
            stats.section_header_blank += 1

        if ORDERED_STEP_RE.match(line) and prev and prev.strip():
            prev_indent = len(prev) - len(prev.lstrip(" "))
            curr_indent = len(line) - len(line.lstrip(" "))
            if (
                prev_indent >= 4
                and curr_indent < 4
                and not ORDERED_STEP_RE.match(prev)
            ):
                out.append("")
                stats.ordered_step_blank += 1

        if is_outdented_prose_after_list(line, prev):
            out.append("")
            stats.prose_outdent_blank += 1

        out.append(line)

        if i + 1 < len(lines) and is_related_link_description(line, lines[i + 1]):
            lines[i + 1] = "    " + lines[i + 1].strip()
            stats.related_link_indent += 1

        i += 1

    return "\n".join(out)


def fix_mdx_content(text: str, stats: FixStats | None = None) -> str:
    local_stats = stats or FixStats()
    frontmatter, body = split_frontmatter(text)
    chunks = split_code_fences(body)
    fixed_chunks: list[str] = []
    for chunk, is_code in chunks:
        if is_code:
            fixed_chunks.append(chunk)
            continue
        chunk = fix_navigation_entities(chunk, local_stats)
        chunk = fix_markdown_body(chunk, local_stats)
        fixed_chunks.append(chunk)
    fixed = frontmatter + "".join(fixed_chunks)
    if text.endswith("\n") and not fixed.endswith("\n"):
        fixed += "\n"
    return fixed


def validate_safe_transform(original: str, fixed: str) -> list[str]:
    errors: list[str] = []
    orig_fm, _ = split_frontmatter(original)
    fixed_fm, _ = split_frontmatter(fixed)
    if orig_fm != fixed_fm:
        errors.append("frontmatter changed")

    # Body text should only gain whitespace separators or decode safe entities.
    def normalize_body(value: str) -> str:
        _, body = split_frontmatter(value)
        body = re.sub(r" &gt; ", " > ", body)
        body = re.sub(r"\*\* &gt; \*\*", "** > **", body)
        body = PRIORITY_GT_RE.sub(r"\1>\2", body)
        body = re.sub(r"\n{3,}", "\n\n", body)
        return body.strip()

    # After normalization, non-whitespace content must be preserved.
    def compact(value: str) -> str:
        return re.sub(r"\s+", "", value)

    orig_body = normalize_body(original)
    fixed_body = normalize_body(fixed)
    if compact(orig_body) != compact(fixed_body):
        errors.append("non-whitespace body content changed")
    return errors


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(PROJECT_ROOT))
    except ValueError:
        return str(path)


def iter_mdx_files(target: Path) -> list[Path]:
    if target.is_file():
        return [target] if target.suffix == ".mdx" else []
    return sorted(target.rglob("*.mdx"))


def process_path(target: Path, write: bool) -> tuple[FixStats, IssueReport]:
    stats = FixStats()
    report = IssueReport()
    for path in iter_mdx_files(target):
        stats.files_scanned += 1
        original = path.read_text(encoding="utf-8")
        fixed = fix_mdx_content(original, stats)
        if fixed == original:
            continue

        safety_errors = validate_safe_transform(original, fixed)
        if safety_errors:
            rel = display_path(path)
            for err in safety_errors:
                report.add(f"{rel}: {err}")
            continue

        stats.files_changed += 1
        if write:
            path.write_text(fixed, encoding="utf-8")
    return stats, report


def scan_issues(target: Path) -> IssueReport:
    report = IssueReport()
    for path in iter_mdx_files(target):
        rel = display_path(path)
        text = path.read_text(encoding="utf-8")
        scannable = iter_scannable_body_lines(text)
        for index, line, prev in scannable:
            if NAV_GT_RE.search(line) or NAV_BOLD_GT_RE.search(line):
                report.add(f"{rel}:{index}: navigation entity &gt; remains")
            if PRIORITY_GT_RE.search(line):
                report.add(f"{rel}:{index}: priority entity &gt; remains")
            if SECTION_HEADER_RE.match(line) and LIST_ITEM_RE.match(prev) and prev.strip():
                report.add(f"{rel}:{index}: section header needs blank line before {line.strip()}")
            if ORDERED_STEP_RE.match(line) and LIST_ITEM_RE.match(prev):
                prev_indent = len(prev) - len(prev.lstrip(" "))
                curr_indent = len(line) - len(line.lstrip(" "))
                if prev_indent >= 4 and curr_indent < 4:
                    report.add(f"{rel}:{index}: ordered step needs blank line before {line.strip()}")
            if is_outdented_prose_after_list(line, prev):
                report.add(f"{rel}:{index}: outdented prose needs blank line before {line.strip()[:50]}")
            lines = text.split("\n")
            if index < len(lines) and is_related_link_description(line, lines[index]):
                report.add(f"{rel}:{index}: related link description needs indent")
    return report


def run_self_tests() -> None:
    cases = [
        (
            "navigation entity",
            "选择**资源清单** &gt; **数据存储**",
            "选择**资源清单** > **数据存储**",
        ),
        (
            "preserve ltgt entity",
            '字符：-\`=[];\',./~!@#$%^&*()_+|{}:"&lt;&gt;?',
            '字符：-\`=[];\',./~!@#$%^&*()_+|{}:"&lt;&gt;?',
        ),
        (
            "section header blank line",
            "    -   **数据中心**：位置\n    **配置信息**\n",
            "    -   **数据中心**：位置\n\n    **配置信息**\n",
        ),
        (
            "ordered step blank line",
            "        -   nested item\n4.  下一步\n",
            "        -   nested item\n\n4.  下一步\n",
        ),
        (
            "related link indent",
            "-   **[链接](/docs/x)**  \n描述文字\n",
            "-   **[链接](/docs/x)**  \n    描述文字\n",
        ),
        (
            "skip code fence",
            "---\ntitle: t\n---\n\n```sh\necho a &gt; b\n```\n",
            "---\ntitle: t\n---\n\n```sh\necho a &gt; b\n```\n",
        ),
        (
            "outdented prose after nested list",
            "                -   nested item\n            当选择指定相同网口添加方式时：\n",
            "                -   nested item\n\n            当选择指定相同网口添加方式时：\n",
        ),
        (
            "skip indented code fence",
            "    ```\n    #cloud-config\n    bootcmd:\n     - mkdir /tmp\n    ```\n",
            "    ```\n    #cloud-config\n    bootcmd:\n     - mkdir /tmp\n    ```\n",
        ),
        (
            "idempotent related link",
            "-   **[链接](/docs/x)**  \n    描述文字\n",
            "-   **[链接](/docs/x)**  \n    描述文字\n",
        ),
    ]

    for name, source, expected in cases:
        result = fix_mdx_content(source)
        if result != expected:
            raise AssertionError(
                f"self-test failed: {name}\nexpected:\n{expected!r}\ngot:\n{result!r}"
            )
        # idempotent
        if fix_mdx_content(result) != result:
            raise AssertionError(f"self-test not idempotent: {name}")

    # safety check
    original = "---\ntitle: \"x\"\n---\n\n1.  step\n"
    fixed = fix_mdx_content(original)
    if validate_safe_transform(original, fixed):
        raise AssertionError("safety check failed for unchanged file")

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
    mode.add_argument("--check", action="store_true", help="report remaining issues and exit 1 if any")
    mode.add_argument("--dry-run", action="store_true", help="show what would change without writing")
    mode.add_argument("--write", action="store_true", help="apply fixes in place")
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
        report = scan_issues(target)
        if not report.issues:
            print(f"check: ok ({len(iter_mdx_files(target))} files)")
            return 0
        print(f"check: found {len(report.issues)} issue(s)")
        for issue in report.issues[:50]:
            print(f"  - {issue}")
        if len(report.issues) > 50:
            print(f"  ... and {len(report.issues) - 50} more")
        return 1

    write = args.write
    if not args.dry_run and not write:
        parser.error("specify one of --check, --dry-run, --write, or --self-test")

    stats, report = process_path(target, write=write)
    if report.issues:
        print("ERROR safety validation failed:", file=sys.stderr)
        for issue in report.issues:
            print(f"  - {issue}", file=sys.stderr)
        return 1

    if write:
        print(
            f"write: scanned {stats.files_scanned} file(s), "
            f"changed {stats.files_changed}"
        )
    else:
        print(
            f"dry-run: scanned {stats.files_scanned} file(s), "
            f"would change {stats.files_changed}"
        )
    print(
        "  "
        + ", ".join(
            f"{key}={getattr(stats, key)}"
            for key in (
                "navigation_gt",
                "navigation_bold_gt",
                "priority_gt",
                "section_header_blank",
                "ordered_step_blank",
                "related_link_indent",
                "prose_outdent_blank",
            )
            if getattr(stats, key)
        )
        or "no rule matches remaining"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
