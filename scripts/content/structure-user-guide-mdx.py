#!/usr/bin/env python3
"""Add structural headings to migrated user-guide MDX files (P2).

Transforms:
  - Standalone **Section** labels -> ##/### headings
  - Bullet blocks before steps -> ## 创建前说明 / ## 前提条件
  - Top-level numbered lists -> prepend ## 操作步骤 when missing
  - Blockquotes -> <Callout>

Skips source-topics/ and index.mdx by default. Idempotent.

Usage:
  python3 scripts/content/structure-user-guide-mdx.py --check
  python3 scripts/content/structure-user-guide-mdx.py --dry-run
  python3 scripts/content/structure-user-guide-mdx.py --write
  python3 scripts/content/structure-user-guide-mdx.py --self-test
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TARGET = PROJECT_ROOT / "content/docs/zh/user-guide"

FRONTMATTER_RE = re.compile(r"\A---\r?\n([\s\S]*?)\r?\n---\r?\n?")
BOLD_SECTION_RE = re.compile(r"^(\s*)\*\*([^*]+)\*\*\s*：?\s*$")
TOP_ORDERED_START_RE = re.compile(r"^[ \t]{0,2}1\.\s")
TOP_ORDERED_RE = re.compile(r"^[ \t]{0,2}\d+\.\s")
ORDERED_RE = re.compile(r"^\d+\.\s")
BULLET_RE = re.compile(r"^\s*-\s")
HEADING_RE = re.compile(r"^#{1,6}\s")
JSX_RE = re.compile(r"^\s*<[A-Za-z]")
BLOCKQUOTE_RE = re.compile(r"^>\s?(.*)$")
HAS_OP_STEPS_RE = re.compile(r"^## 操作步骤\s*$", re.M)
HAS_PREREQ_RE = re.compile(r"^## (前提条件|创建前说明)\s*$", re.M)
STEPS_COMPONENT_RE = re.compile(r"<Steps>")

H2_SECTION_LABELS = frozenset(
    {
        "操作步骤",
        "前提条件",
        "前置条件",
        "创建前说明",
        "注意事项",
        "最佳实践",
    }
)

SKIP_DIR_NAMES = frozenset({"source-topics"})
SKIP_FILENAMES = frozenset({"index.mdx"})


@dataclass
class StructureStats:
    files_scanned: int = 0
    files_changed: int = 0
    files_skipped: int = 0
    bold_to_heading: int = 0
    prerequisite_section: int = 0
    operation_steps_section: int = 0
    blockquote_to_callout: int = 0

    def merge(self, other: StructureStats) -> None:
        for key in self.__dataclass_fields__:
            setattr(self, key, getattr(self, key) + getattr(other, key))


@dataclass
class IssueReport:
    issues: list[str] = field(default_factory=list)

    def add(self, message: str) -> None:
        self.issues.append(message)


def split_frontmatter(text: str) -> tuple[str, str, str]:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return "", "", text
    return match.group(0), match.group(1), text[match.end() :]


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


PREREQ_HEADINGS = frozenset({"## 前提条件", "## 创建前说明"})


def first_h2_index(lines: list[str]) -> int | None:
    for index, line in enumerate(lines):
        if line.startswith("## ") and not line.startswith("### "):
            return index
    return None


def first_non_prereq_h2_index(lines: list[str]) -> int | None:
    for index, line in enumerate(lines):
        if line.startswith("## ") and not line.startswith("### "):
            if line.strip() in PREREQ_HEADINGS:
                continue
            return index
    return None


def has_prior_h2(lines: list[str], index: int) -> bool:
    first = first_h2_index(lines)
    return first is not None and first < index


def heading_for_label(label: str, lines: list[str], index: int) -> str:
    clean = label.strip()
    if clean in H2_SECTION_LABELS and not has_prior_h2(lines, index):
        return f"## {clean}"
    return f"### {clean}"


def is_prose_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if HEADING_RE.match(stripped):
        return False
    if BULLET_RE.match(line):
        return False
    if ORDERED_RE.match(line):
        return False
    if JSX_RE.match(line):
        return False
    if stripped.startswith("```"):
        return False
    return True


def prerequisite_heading(lines: list[str], bullet_start: int, bullet_end: int) -> str:
    bullet_text = "\n".join(lines[bullet_start:bullet_end])
    requirement_markers = ("需", "确保", "请确保", "具备", "权限", "有效", "已")
    if any(marker in bullet_text for marker in requirement_markers):
        return "## 前提条件"
    prose_before = any(is_prose_line(line) for line in lines[:bullet_start])
    if prose_before:
        return "## 创建前说明"
    return "## 前提条件"


def has_operation_heading_before(lines: list[str], index: int) -> bool:
    for line in lines[:index]:
        stripped = line.strip()
        if stripped in ("## 操作步骤", "### 操作步骤"):
            return True
        if BOLD_SECTION_RE.match(line) and line.strip().startswith("**操作步骤"):
            return True
    return False


def first_top_ordered_index(lines: list[str]) -> int | None:
    for index, line in enumerate(lines):
        if TOP_ORDERED_START_RE.match(line):
            return index
    return None


def callout_type(content: str) -> str:
    warning_markers = ("请谨慎", "谨慎操作", "不可恢复", "危险", "避免", "请勿", "将删除")
    return "warning" if any(marker in content for marker in warning_markers) else "info"


def structure_body(body: str, stats: StructureStats) -> str:
    lines = body.split("\n")
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]

        blockquote = BLOCKQUOTE_RE.match(line)
        if blockquote and blockquote.group(1).strip():
            content = blockquote.group(1).strip()
            ctype = callout_type(content)
            stats.blockquote_to_callout += 1
            out.append("")
            out.append(f'<Callout type="{ctype}">')
            out.append("")
            out.append(content)
            out.append("")
            out.append("</Callout>")
            i += 1
            continue

        bold = BOLD_SECTION_RE.match(line)
        if bold and bold.group(2).strip() not in ("Note",):
            label = bold.group(2).strip()
            heading = heading_for_label(label, lines, i)
            if out and out[-1].strip():
                out.append("")
            out.append(heading)
            stats.bold_to_heading += 1
            i += 1
            continue

        out.append(line)
        i += 1

    lines = out

    if not HAS_PREREQ_RE.search("\n".join(lines)):
        first_ord = first_top_ordered_index(lines)
        first_h2 = first_non_prereq_h2_index(lines)
        if first_ord is not None and (first_h2 is None or first_h2 > first_ord):
            bullet_indices = [
                idx
                for idx, line in enumerate(lines[:first_ord])
                if BULLET_RE.match(line)
            ]
            if bullet_indices and (first_h2 is None or bullet_indices[0] < first_h2):
                bullet_start = bullet_indices[0]
                bullet_end = first_ord
                while bullet_end > bullet_start and not lines[bullet_end - 1].strip():
                    bullet_end -= 1
                heading = prerequisite_heading(lines, bullet_start, bullet_end)
                prefix = lines[:bullet_start]
                while prefix and not prefix[-1].strip():
                    prefix.pop()
                lines = [*prefix, "", heading, "", *lines[bullet_start:]]
                stats.prerequisite_section += 1
                first_ord = first_top_ordered_index(lines)
                if first_ord is None:
                    return "\n".join(lines)

    if not HAS_OP_STEPS_RE.search("\n".join(lines)) and not STEPS_COMPONENT_RE.search(
        "\n".join(lines)
    ):
        first_ord = first_top_ordered_index(lines)
        first_h2 = first_non_prereq_h2_index(lines)
        if (
            first_ord is not None
            and (first_h2 is None or first_ord < first_h2)
            and not has_operation_heading_before(lines, first_ord)
        ):
            insert_lines: list[str] = ["## 操作步骤", ""]
            prefix = lines[:first_ord]
            suffix = lines[first_ord:]
            if prefix and prefix[-1].strip():
                lines = [*prefix, "", *insert_lines, *suffix]
            else:
                lines = [*prefix, *insert_lines, *suffix]
            stats.operation_steps_section += 1

    return "\n".join(lines)


def structure_mdx_content(text: str, stats: StructureStats | None = None) -> str:
    local_stats = stats or StructureStats()
    frontmatter, _, body = split_frontmatter(text)

    chunks = split_code_fences(body)
    fixed_chunks: list[str] = []
    for chunk, is_code in chunks:
        if is_code:
            fixed_chunks.append(chunk)
            continue
        fixed_chunks.append(structure_body(chunk, local_stats))

    new_frontmatter = frontmatter
    fixed = new_frontmatter + "".join(fixed_chunks)
    if text.endswith("\n") and not fixed.endswith("\n"):
        fixed += "\n"
    return fixed


def should_skip(path: Path) -> bool:
    if path.name in SKIP_FILENAMES:
        return True
    return any(part in SKIP_DIR_NAMES for part in path.parts)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(PROJECT_ROOT))
    except ValueError:
        return str(path)


def iter_mdx_files(target: Path) -> list[Path]:
    if target.is_file():
        return [target] if target.suffix == ".mdx" else []
    return sorted(target.rglob("*.mdx"))


def process_path(target: Path, write: bool) -> tuple[StructureStats, IssueReport]:
    stats = StructureStats()
    report = IssueReport()
    for path in iter_mdx_files(target):
        if should_skip(path):
            stats.files_skipped += 1
            continue
        stats.files_scanned += 1
        original = path.read_text(encoding="utf-8")
        file_stats = StructureStats()
        fixed = structure_mdx_content(original, file_stats)
        if fixed == original:
            continue
        stats.files_changed += 1
        stats.merge(file_stats)
        if write:
            path.write_text(fixed, encoding="utf-8")
    return stats, report


def scan_remaining(target: Path) -> IssueReport:
    report = IssueReport()
    for path in iter_mdx_files(target):
        if should_skip(path):
            continue
        rel = display_path(path)
        text = path.read_text(encoding="utf-8")
        _, _, body = split_frontmatter(text)
        if BOLD_SECTION_RE.search(body):
            for index, line in enumerate(body.split("\n"), start=1):
                if BOLD_SECTION_RE.match(line):
                    report.add(f"{rel}:{index}: standalone bold section remains: {line.strip()}")
        if BLOCKQUOTE_RE.search(body):
            report.add(f"{rel}: blockquote remains")
        lines = body.split("\n")
        first_ord = first_top_ordered_index(lines)
        first_h2 = first_non_prereq_h2_index(lines)
        if first_ord is not None:
            if (
                (first_h2 is None or first_ord < first_h2)
                and not HAS_OP_STEPS_RE.search(body)
                and not STEPS_COMPONENT_RE.search(body)
                and not has_operation_heading_before(lines, first_ord)
            ):
                report.add(f"{rel}: top-level ordered list missing ## 操作步骤")
    return report


def run_self_tests() -> None:
    cases = [
        (
            "bold section in form",
            "3.  配置：\n\n    **基本信息**\n\n    -   **名称**：x\n",
            "3.  配置：\n\n### 基本信息\n\n    -   **名称**：x\n",
        ),
        (
            "add operation steps",
            "创建标签。\n\n1.  打开页面。\n",
            "创建标签。\n\n## 操作步骤\n\n1.  打开页面。\n",
        ),
        (
            "prerequisite bullets",
            "创建用户。\n\n-   需具备 admin 权限。\n\n1.  打开页面。\n",
            "创建用户。\n\n## 前提条件\n\n-   需具备 admin 权限。\n\n## 操作步骤\n\n1.  打开页面。\n",
        ),
        (
            "nested ordered list skip",
            "例如：\n\n    1.  子步骤\n\n1.  顶层步骤\n",
            "例如：\n\n    1.  子步骤\n\n## 操作步骤\n\n1.  顶层步骤\n",
        ),
        (
            "bold operation under h2",
            "## 配置引导选项\n\n**操作步骤**\n\n1.  步骤\n",
            "## 配置引导选项\n\n### 操作步骤\n\n1.  步骤\n",
        ),
        (
            "blockquote to callout",
            "> 请谨慎操作。\n",
            '\n<Callout type="warning">\n\n请谨慎操作。\n\n</Callout>\n',
        ),
        (
            "skip code fence",
            "```\n**基本信息**\n```\n",
            "```\n**基本信息**\n```\n",
        ),
        (
            "skip field validation prose",
            "## 前提条件\n\n- item\n\n1. step\n",
            "## 前提条件\n\n- item\n\n## 操作步骤\n\n1. step\n",
        ),
        (
            "idempotent heading",
            "### 基本信息\n\n- item\n",
            "### 基本信息\n\n- item\n",
        ),
    ]

    for name, source_body, expected_fragment in cases:
        if name == "add operation steps":
            source = f'---\ntitle: "t"\n---\n\n{source_body}'
            result = structure_mdx_content(source)
            _, _, result_body = split_frontmatter(result)
            result_body = result_body.lstrip("\n")
            if expected_fragment != result_body:
                raise AssertionError(f"self-test failed: {name}\n{result_body!r}")
        else:
            source = f'---\ntitle: "t"\n---\n\n{source_body}'
            result = structure_mdx_content(source)
            _, _, result_body = split_frontmatter(result)
            result_body = result_body.lstrip("\n")
            expected_fragment = expected_fragment.lstrip("\n")
            if expected_fragment != result_body:
                raise AssertionError(
                    f"self-test failed: {name}\nexpected:\n{expected_fragment!r}\ngot:\n{result_body!r}"
                )
        if structure_mdx_content(result) != result:
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
    mode.add_argument("--check", action="store_true", help="report remaining structural issues")
    mode.add_argument("--dry-run", action="store_true", help="show what would change")
    mode.add_argument("--write", action="store_true", help="apply transforms in place")
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
        report = scan_remaining(target)
        scanned = sum(
            1 for p in iter_mdx_files(target) if not should_skip(p)
        )
        if not report.issues:
            print(f"check: ok ({scanned} files)")
            return 0
        print(f"check: found {len(report.issues)} issue(s) in {scanned} files")
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
        print("ERROR:", file=sys.stderr)
        for issue in report.issues:
            print(f"  - {issue}", file=sys.stderr)
        return 1

    verb = "write" if write else "dry-run"
    print(
        f"{verb}: scanned {stats.files_scanned} file(s), "
        f"skipped {stats.files_skipped}, changed {stats.files_changed}"
    )
    print(
        "  "
        + ", ".join(
            f"{key}={getattr(stats, key)}"
            for key in (
                "bold_to_heading",
                "prerequisite_section",
                "operation_steps_section",
                "blockquote_to_callout",
            )
            if getattr(stats, key)
        )
        or "no rule matches"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
