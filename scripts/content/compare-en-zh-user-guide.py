#!/usr/bin/env python3
"""
Compare Chinese and English user-guide docs for Fumadocs parity.

The script runs deterministic checks by default and can optionally call an LLM
for semantic translation review when --llm is provided.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ZH_ROOT = PROJECT_ROOT / "content/docs/zh/user-guide"
DEFAULT_EN_ROOT = PROJECT_ROOT / "content/docs/en/user-guide"
DEFAULT_REPORT = PROJECT_ROOT / "artifacts/content/en-zh-doc-parity-report.md"
DEFAULT_JSON_REPORT = PROJECT_ROOT / "artifacts/content/en-zh-doc-parity-report.json"

FRONTMATTER_RE = re.compile(r"\A---\r?\n([\s\S]*?)\r?\n---\r?\n?")
TITLE_RE = re.compile(r'^title:\s*["\']?([^"\']+)["\']?\s*$', re.M)
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$", re.M)
CODE_FENCE_RE = re.compile(r"^```([A-Za-z0-9_+-]*)\s*$", re.M)
LINK_RE = re.compile(r"(?<!!)\[([^\]]*)\]\(([^)]+)\)")
IMAGE_MD_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
IMAGE_JSX_RE = re.compile(r"<(?:img|ImageZoom)\b[^>]*\bsrc=[\"']([^\"']+)[\"'][^>]*>", re.S)
ALT_JSX_RE = re.compile(r"\balt=[\"']([^\"']*)[\"']")
COMPONENT_RE = re.compile(r"<([A-Z][A-Za-z0-9]*)\b")
CALLOUT_RE = re.compile(r"<Callout\b[^>]*\btype=[\"']([^\"']+)[\"']", re.I)
HTML_TABLE_RE = re.compile(r"<table\b[\s\S]*?</table>", re.I)
TABLE_TAG_RE = re.compile(r"<(t[dh])\b([^>]*)>", re.I)
ROW_RE = re.compile(r"<tr\b[\s\S]*?</tr>", re.I)
MD_TABLE_ROW_RE = re.compile(r"^\s*\|.*\|\s*$")
CJK_RE = re.compile(r"[\u4e00-\u9fff]")


COMPARISON_PROMPT = """
You are a bilingual technical documentation QA reviewer. The Chinese document is
the source structure and the English document is the migrated translation.

Check:
1. Content completeness: whether the English content preserves all key points from Chinese.
2. Translation accuracy: whether technical terms are accurate and consistent.
3. Format consistency: whether headings, lists, tables, code blocks, links, and images match.
4. Open-source boundary: whether the English text adds commercial-only information not present in Chinese.

Return JSON only:
{
  "completeness_score": 0-100,
  "accuracy_score": 0-100,
  "format_consistency": true,
  "issues": [
    {
      "type": "translation|format|missing|style|extra",
      "severity": "critical|major|minor",
      "description": "issue description",
      "suggestion": "suggested fix"
    }
  ],
  "summary": "overall assessment"
}

Chinese source:
{zh_content}

English translation:
{en_content}
""".strip()


@dataclass
class Issue:
    slug: str
    category: str
    severity: str
    message: str
    suggestion: str = ""


@dataclass
class PageInfo:
    slug: str
    path: Path
    title: str
    body: str
    frontmatter: str


@dataclass
class NavItem:
    slug: str
    depth: int
    title: str
    meta_path: str


@dataclass
class PageMetrics:
    headings: list[tuple[int, str]]
    code_langs: list[str]
    links: list[tuple[str, str]]
    images: list[tuple[str, str]]
    components: list[str]
    callout_types: list[str]
    html_table_skeletons: list[list[list[tuple[str, str, str]]]]
    md_table_shapes: list[list[int]]
    paragraph_count: int


class DocComparator:
    """Compare zh/en Fumadocs user-guide content."""

    def __init__(
        self,
        en_path: str | Path,
        zh_path: str | Path,
        api_key: str | None = None,
        model: str = "gpt-4o-mini",
        enable_llm: bool = False,
    ) -> None:
        self.en_path = Path(en_path)
        self.zh_path = Path(zh_path)
        self.api_key = api_key
        self.model = model
        self.enable_llm = enable_llm
        self.issues: list[Issue] = []
        self.llm_results: dict[str, Any] = {}

    def scan_files(self) -> dict[str, dict[str, Path]]:
        """Scan zh/en MDX files and map them by route slug."""
        slugs: dict[str, dict[str, Path]] = {}
        for lang, root in (("zh", self.zh_path), ("en", self.en_path)):
            for path in sorted(root.rglob("*.mdx")):
                if "source-topics" in path.parts:
                    continue
                slug = self.slug_for_path(root, path)
                slugs.setdefault(slug, {})[lang] = path
        return slugs

    @staticmethod
    def slug_for_path(root: Path, path: Path) -> str:
        slug = path.relative_to(root).with_suffix("").as_posix()
        return slug[:-6] if slug.endswith("/index") else slug

    def read_page(self, path: Path, slug: str) -> PageInfo:
        text = path.read_text(encoding="utf-8")
        frontmatter, body = self.split_frontmatter(text)
        title = self.extract_title(frontmatter) or self.title_from_body(body) or slug.rsplit("/", 1)[-1]
        return PageInfo(slug=slug, path=path, title=title, body=body, frontmatter=frontmatter)

    @staticmethod
    def split_frontmatter(text: str) -> tuple[str, str]:
        match = FRONTMATTER_RE.match(text)
        if not match:
            return "", text
        return match.group(1), text[match.end() :]

    @staticmethod
    def extract_title(frontmatter: str) -> str:
        match = TITLE_RE.search(frontmatter)
        return match.group(1).strip() if match else ""

    @staticmethod
    def title_from_body(body: str) -> str:
        match = HEADING_RE.search(body)
        return match.group(2).strip() if match else ""

    def parse_navigation(self, root: Path) -> list[NavItem]:
        """Parse Fumadocs meta.json/_meta.json navigation recursively."""
        return self._parse_navigation_dir(root, "", 0)

    def _meta_file(self, directory: Path) -> Path | None:
        for name in ("meta.json", "_meta.json", "fumadocs.json"):
            candidate = directory / name
            if candidate.exists():
                return candidate
        return None

    def _parse_navigation_dir(self, root: Path, prefix: str, depth: int) -> list[NavItem]:
        directory = root / prefix if prefix else root
        meta = self._meta_file(directory)
        if not meta:
            return []
        data = json.loads(meta.read_text(encoding="utf-8"))
        items: list[NavItem] = []
        for page in data.get("pages", []):
            if not isinstance(page, str):
                continue
            slug = f"{prefix}/{page}".strip("/")
            title = self.page_title_for_slug(root, slug) or page
            items.append(NavItem(slug=slug, depth=depth, title=title, meta_path=meta.relative_to(root).as_posix()))
            if (root / slug / "meta.json").exists() or (root / slug / "_meta.json").exists():
                items.extend(self._parse_navigation_dir(root, slug, depth + 1))
        return items

    def page_title_for_slug(self, root: Path, slug: str) -> str:
        path = self.page_path(root, slug)
        if not path:
            return ""
        frontmatter, body = self.split_frontmatter(path.read_text(encoding="utf-8"))
        return self.extract_title(frontmatter) or self.title_from_body(body)

    @staticmethod
    def page_path(root: Path, slug: str) -> Path | None:
        direct = root / f"{slug}.mdx"
        if direct.exists():
            return direct
        index = root / slug / "index.mdx"
        if index.exists():
            return index
        return None

    def compare_navigation(self, en_nav: list[NavItem], zh_nav: list[NavItem]) -> None:
        en_by_slug = {item.slug: item for item in en_nav}
        zh_by_slug = {item.slug: item for item in zh_nav}
        for slug, zh_item in zh_by_slug.items():
            en_item = en_by_slug.get(slug)
            if not en_item:
                self.add_issue(slug, "navigation", "critical", "English navigation item is missing.")
                continue
            if en_item.depth != zh_item.depth:
                self.add_issue(
                    slug,
                    "navigation",
                    "major",
                    f"Navigation depth mismatch: zh={zh_item.depth}, en={en_item.depth}.",
                )
        for slug in sorted(set(en_by_slug) - set(zh_by_slug)):
            self.add_issue(slug, "navigation", "major", "English navigation has an extra item.")

        zh_order = [item.slug for item in zh_nav]
        en_order = [item.slug for item in en_nav]
        if [s for s in zh_order if s in en_by_slug] != [s for s in en_order if s in zh_by_slug]:
            self.add_issue("__navigation_order__", "navigation", "major", "Navigation order differs between zh and en.")

    def compare_md_content(self, en_file: Path, zh_file: Path, slug: str) -> None:
        en_page = self.read_page(en_file, slug)
        zh_page = self.read_page(zh_file, slug)
        en_metrics = self.extract_metrics(en_page.body)
        zh_metrics = self.extract_metrics(zh_page.body)

        self.compare_headings(slug, en_metrics, zh_metrics)
        self.compare_code_blocks(slug, en_metrics, zh_metrics)
        self.compare_links(slug, en_metrics, zh_metrics)
        self.compare_images(slug, en_metrics, zh_metrics)
        self.compare_components(slug, en_metrics, zh_metrics)
        self.compare_tables(slug, en_metrics, zh_metrics)
        self.compare_paragraphs(slug, en_metrics, zh_metrics)
        self.check_fumadocs_style(en_page.body, "en", slug)
        self.check_fumadocs_style(zh_page.body, "zh", slug)

        if self.enable_llm:
            self.compare_with_llm(slug, zh_page.body, en_page.body)

    def extract_metrics(self, body: str) -> PageMetrics:
        return PageMetrics(
            headings=[(len(m.group(1)), self.clean_inline(m.group(2))) for m in HEADING_RE.finditer(body)],
            code_langs=[m.group(1).strip() for m in CODE_FENCE_RE.finditer(body)],
            links=[(m.group(1), m.group(2)) for m in LINK_RE.finditer(body)],
            images=self.extract_images(body),
            components=COMPONENT_RE.findall(body),
            callout_types=CALLOUT_RE.findall(body),
            html_table_skeletons=[self.html_table_skeleton(table) for table in HTML_TABLE_RE.findall(body)],
            md_table_shapes=self.md_table_shapes(body),
            paragraph_count=self.paragraph_count(body),
        )

    @staticmethod
    def clean_inline(text: str) -> str:
        return re.sub(r"\s+", " ", re.sub(r"<[^>]+>|[`*_]", "", text)).strip()

    def extract_images(self, body: str) -> list[tuple[str, str]]:
        images = [(m.group(2), m.group(1)) for m in IMAGE_MD_RE.finditer(body)]
        for match in IMAGE_JSX_RE.finditer(body):
            tag = match.group(0)
            alt_match = ALT_JSX_RE.search(tag)
            images.append((match.group(1), alt_match.group(1) if alt_match else ""))
        return images

    def html_table_skeleton(self, table: str) -> list[list[tuple[str, str, str]]]:
        rows: list[list[tuple[str, str, str]]] = []
        for row in ROW_RE.findall(table):
            cells: list[tuple[str, str, str]] = []
            for tag, attrs in TABLE_TAG_RE.findall(row):
                row_span = self.attr_value(attrs, "rowSpan") or self.attr_value(attrs, "rowspan") or "1"
                col_span = self.attr_value(attrs, "colSpan") or self.attr_value(attrs, "colspan") or "1"
                cells.append((tag.lower(), row_span, col_span))
            if cells:
                rows.append(cells)
        return rows

    @staticmethod
    def attr_value(attrs: str, name: str) -> str:
        match = re.search(rf'\b{name}=["\']([^"\']+)["\']', attrs)
        return match.group(1) if match else ""

    def md_table_shapes(self, body: str) -> list[list[int]]:
        lines = body.splitlines()
        shapes: list[list[int]] = []
        i = 0
        while i < len(lines):
            header = self.parse_md_table_row(lines[i])
            sep = self.parse_md_table_row(lines[i + 1]) if header and i + 1 < len(lines) else None
            if header and sep and self.is_md_separator(sep):
                shape = [len(header)]
                j = i + 2
                while j < len(lines):
                    row = self.parse_md_table_row(lines[j])
                    if not row or self.is_md_separator(row):
                        break
                    shape.append(len(row))
                    j += 1
                shapes.append(shape)
                i = j
                continue
            i += 1
        return shapes

    @staticmethod
    def parse_md_table_row(line: str) -> list[str] | None:
        if not MD_TABLE_ROW_RE.match(line):
            return None
        return [cell.strip() for cell in line.strip()[1:-1].split("|")]

    @staticmethod
    def is_md_separator(cells: list[str]) -> bool:
        return bool(cells) and all(re.fullmatch(r":?-{1,}:?", cell.replace(" ", "")) for cell in cells)

    @staticmethod
    def paragraph_count(body: str) -> int:
        cleaned = FRONTMATTER_RE.sub("", body)
        cleaned = re.sub(r"```[\s\S]*?```", "", cleaned)
        cleaned = re.sub(r"<table[\s\S]*?</table>", "", cleaned, flags=re.I)
        blocks = [b.strip() for b in re.split(r"\n\s*\n", cleaned) if b.strip()]
        return len([b for b in blocks if not b.startswith(("#", "<", "|"))])

    def compare_headings(self, slug: str, en: PageMetrics, zh: PageMetrics) -> None:
        zh_levels = [level for level, _ in zh.headings]
        en_levels = [level for level, _ in en.headings]
        if zh_levels != en_levels:
            self.add_issue(slug, "content", "major", f"Heading level sequence differs: zh={zh_levels}, en={en_levels}.")

    def compare_code_blocks(self, slug: str, en: PageMetrics, zh: PageMetrics) -> None:
        if len(en.code_langs) != len(zh.code_langs):
            self.add_issue(slug, "content", "major", f"Code block count differs: zh={len(zh.code_langs)}, en={len(en.code_langs)}.")
        for index, lang in enumerate(en.code_langs):
            if not lang:
                self.add_issue(slug, "style", "minor", f"English code block #{index + 1} has no language identifier.")

    def compare_links(self, slug: str, en: PageMetrics, zh: PageMetrics) -> None:
        if len(en.links) != len(zh.links):
            self.add_issue(slug, "content", "minor", f"Link count differs: zh={len(zh.links)}, en={len(en.links)}.")
        for _, href in en.links:
            if href.startswith("/docs/"):
                self.add_issue(slug, "content", "major", f"English link points to Chinese route: {href}.")
            if "source-topics" in href:
                self.add_issue(slug, "content", "major", f"English link points to source-topics: {href}.")

    def compare_images(self, slug: str, en: PageMetrics, zh: PageMetrics) -> None:
        if len(en.images) != len(zh.images):
            self.add_issue(slug, "content", "major", f"Image count differs: zh={len(zh.images)}, en={len(en.images)}.")
        for src, alt in en.images:
            if CJK_RE.search(alt):
                self.add_issue(slug, "content", "minor", f"English image alt text contains Chinese: {alt}.")
            if "/zh/" in src or src.startswith("/docs/user-guide/images/zh"):
                self.add_issue(slug, "content", "major", f"English image may use Chinese asset: {src}.")

    def compare_components(self, slug: str, en: PageMetrics, zh: PageMetrics) -> None:
        if en.components != zh.components:
            self.add_issue(slug, "style", "major", f"Fumadocs component sequence differs: zh={zh.components}, en={en.components}.")
        if en.callout_types != zh.callout_types:
            self.add_issue(slug, "style", "major", f"Callout type sequence differs: zh={zh.callout_types}, en={en.callout_types}.")

    def compare_tables(self, slug: str, en: PageMetrics, zh: PageMetrics) -> None:
        zh_count = len(zh.html_table_skeletons) + len(zh.md_table_shapes)
        en_count = len(en.html_table_skeletons) + len(en.md_table_shapes)
        if zh_count != en_count:
            self.add_issue(slug, "style", "critical", f"Table count differs: zh={zh_count}, en={en_count}.")
        if len(zh.html_table_skeletons) == len(en.html_table_skeletons):
            for index, (zh_table, en_table) in enumerate(zip(zh.html_table_skeletons, en.html_table_skeletons), start=1):
                if zh_table != en_table:
                    self.add_issue(slug, "style", "critical", f"HTML table #{index} skeleton differs from Chinese.")
        for index, shape in enumerate(en.md_table_shapes, start=1):
            if len(set(shape)) > 1:
                self.add_issue(slug, "style", "critical", f"English Markdown table #{index} has inconsistent column counts: {shape}.")

    def compare_paragraphs(self, slug: str, en: PageMetrics, zh: PageMetrics) -> None:
        if zh.paragraph_count and abs(en.paragraph_count - zh.paragraph_count) > max(3, zh.paragraph_count * 0.4):
            self.add_issue(
                slug,
                "content",
                "minor",
                f"Paragraph count differs significantly: zh={zh.paragraph_count}, en={en.paragraph_count}.",
            )

    def check_fumadocs_style(self, content: str, lang: str, slug: str) -> None:
        if re.search(r"<table\b[^>]*\bclass=", content):
            self.add_issue(slug, "style", "major", f"{lang} table uses HTML class instead of MDX className.")
        if re.search(r"\b(rowspan|colspan)=", content):
            self.add_issue(slug, "style", "major", f"{lang} table uses lowercase rowspan/colspan instead of rowSpan/colSpan.")
        if re.search(r"\*\*(Note|Warning|Caution|Important):\*\*", content, re.I):
            self.add_issue(slug, "style", "minor", f"{lang} contains raw DITA note labels instead of Callout.")
        if re.search(r"^#{1,6} .*\{(?:#| \.)", content, re.M):
            self.add_issue(slug, "style", "major", f"{lang} contains DITA heading attributes.")
        if re.search(r"^```\s+\{#", content, re.M):
            self.add_issue(slug, "style", "major", f"{lang} contains DITA code fence attributes.")

    def compare_with_llm(self, slug: str, zh_content: str, en_content: str) -> None:
        if not self.api_key:
            self.add_issue(slug, "llm", "minor", "LLM comparison skipped because OPENAI_API_KEY is not set.")
            return
        try:
            from openai import OpenAI  # type: ignore
        except Exception as exc:  # pragma: no cover
            self.add_issue(slug, "llm", "minor", f"LLM comparison skipped because openai is unavailable: {exc}.")
            return
        client = OpenAI(api_key=self.api_key)
        prompt = COMPARISON_PROMPT.format(
            zh_content=self.truncate_for_llm(zh_content),
            en_content=self.truncate_for_llm(en_content),
        )
        response = client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        raw = response.choices[0].message.content or "{}"
        try:
            result = json.loads(self.extract_json(raw))
        except json.JSONDecodeError:
            self.add_issue(slug, "llm", "minor", "LLM returned non-JSON output.", raw[:500])
            return
        self.llm_results[slug] = result
        for item in result.get("issues", []):
            self.add_issue(
                slug,
                item.get("type", "translation"),
                item.get("severity", "minor"),
                item.get("description", ""),
                item.get("suggestion", ""),
            )

    @staticmethod
    def truncate_for_llm(text: str, limit: int = 16000) -> str:
        return text if len(text) <= limit else text[:limit] + "\n\n[TRUNCATED]"

    @staticmethod
    def extract_json(text: str) -> str:
        match = re.search(r"\{[\s\S]*\}", text)
        return match.group(0) if match else text

    def add_issue(self, slug: str, category: str, severity: str, message: str, suggestion: str = "") -> None:
        self.issues.append(Issue(slug=slug, category=category, severity=severity, message=message, suggestion=suggestion))

    def generate_report(self) -> str:
        severity_order = {"critical": 0, "major": 1, "minor": 2}
        sorted_issues = sorted(self.issues, key=lambda i: (severity_order.get(i.severity, 9), i.slug, i.category))
        counts: dict[str, int] = {}
        for issue in sorted_issues:
            counts[issue.severity] = counts.get(issue.severity, 0) + 1
        lines = [
            "# English/Chinese Documentation Parity Report",
            "",
            "## Summary",
            "",
            f"- Total issues: {len(sorted_issues)}",
            f"- Critical: {counts.get('critical', 0)}",
            f"- Major: {counts.get('major', 0)}",
            f"- Minor: {counts.get('minor', 0)}",
            "",
            "## Issues",
            "",
        ]
        if not sorted_issues:
            lines.append("No issues found.")
        for issue in sorted_issues:
            lines.append(f"### `{issue.slug}`")
            lines.append("")
            lines.append(f"- Severity: `{issue.severity}`")
            lines.append(f"- Category: `{issue.category}`")
            lines.append(f"- Issue: {issue.message}")
            if issue.suggestion:
                lines.append(f"- Suggestion: {issue.suggestion}")
            lines.append("")
        return "\n".join(lines) + "\n"

    def generate_json_report(self) -> dict[str, Any]:
        return {
            "issue_count": len(self.issues),
            "issues": [issue.__dict__ for issue in self.issues],
            "llm_results": self.llm_results,
        }

    def run(self, report_path: Path, json_report_path: Path) -> int:
        print("Starting zh/en document parity comparison...")
        file_map = self.scan_files()
        zh_nav = self.parse_navigation(self.zh_path)
        en_nav = self.parse_navigation(self.en_path)
        self.compare_navigation(en_nav, zh_nav)

        for slug in sorted(file_map):
            paths = file_map[slug]
            zh_file = paths.get("zh")
            en_file = paths.get("en")
            if zh_file and not en_file:
                self.add_issue(slug, "file", "critical", "English page is missing.")
                continue
            if en_file and not zh_file:
                self.add_issue(slug, "file", "major", "English page has no Chinese counterpart.")
                continue
            if zh_file and en_file:
                self.compare_md_content(en_file, zh_file, slug)

        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(self.generate_report(), encoding="utf-8")
        json_report_path.parent.mkdir(parents=True, exist_ok=True)
        json_report_path.write_text(json.dumps(self.generate_json_report(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Markdown report: {report_path}")
        print(f"JSON report: {json_report_path}")
        print(f"Issues: {len(self.issues)}")
        return 1 if any(issue.severity == "critical" for issue in self.issues) else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare zh/en Fumadocs user-guide parity.")
    parser.add_argument("--en-root", default=str(DEFAULT_EN_ROOT))
    parser.add_argument("--zh-root", default=str(DEFAULT_ZH_ROOT))
    parser.add_argument("--report", default=str(DEFAULT_REPORT))
    parser.add_argument("--json-report", default=str(DEFAULT_JSON_REPORT))
    parser.add_argument("--llm", action="store_true", help="Enable optional LLM semantic comparison.")
    parser.add_argument("--model", default=os.getenv("OPENAI_MODEL", "gpt-4o-mini"))
    parser.add_argument("--api-key", default=os.getenv("OPENAI_API_KEY"))
    args = parser.parse_args()

    comparator = DocComparator(
        en_path=args.en_root,
        zh_path=args.zh_root,
        api_key=args.api_key,
        model=args.model,
        enable_llm=args.llm,
    )
    return comparator.run(Path(args.report), Path(args.json_report))


if __name__ == "__main__":
    sys.exit(main())
