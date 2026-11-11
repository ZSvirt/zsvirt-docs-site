#!/usr/bin/env python3
"""Regression tests for Terraform documentation synchronization."""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


SCRIPT_ROOT = Path(__file__).resolve().parent


def load_script(module_name: str, filename: str):
    spec = importlib.util.spec_from_file_location(module_name, SCRIPT_ROOT / filename)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {filename}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


convert = load_script("convert_terraform_docs", "convert-terraform-docs.py")
translate = load_script(
    "translate_terraform_docs_zh",
    "translate-terraform-docs-zh.py",
)


class TerraformDocsSyncTests(unittest.TestCase):
    def test_convert_directory_reports_and_removes_orphans(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            source_dir = root / "source"
            target_dir = root / "target"
            source_dir.mkdir()
            target_dir.mkdir()
            (source_dir / "active.md").write_text(
                "---\npage_title: \"Active Resource - zsphere\"\n---\n# Active\n",
                encoding="utf-8",
            )
            (target_dir / "index.mdx").write_text("manual index\n", encoding="utf-8")
            orphan_path = target_dir / "removed.mdx"
            orphan_path.write_text("obsolete\n", encoding="utf-8")

            self.assertEqual(
                convert.convert_directory(source_dir, target_dir, check=True),
                2,
            )
            self.assertTrue(orphan_path.exists())
            self.assertEqual(
                convert.convert_directory(source_dir, target_dir, check=False),
                2,
            )
            self.assertFalse(orphan_path.exists())
            self.assertTrue((target_dir / "index.mdx").exists())

    def test_translate_directory_reports_and_removes_orphans(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            en_dir = root / "en"
            zh_dir = root / "zh"
            en_dir.mkdir()
            zh_dir.mkdir()
            (en_dir / "cluster.mdx").write_text(
                "---\ntitle: 'Cluster'\n---\n\n## Schema\n",
                encoding="utf-8",
            )
            (zh_dir / "index.mdx").write_text("manual index\n", encoding="utf-8")
            orphan_path = zh_dir / "removed.mdx"
            orphan_path.write_text("obsolete\n", encoding="utf-8")

            self.assertEqual(
                translate.translate_directory(en_dir, zh_dir, check=True),
                2,
            )
            self.assertTrue(orphan_path.exists())
            self.assertEqual(
                translate.translate_directory(en_dir, zh_dir, check=False),
                2,
            )
            self.assertFalse(orphan_path.exists())
            self.assertTrue((zh_dir / "index.mdx").exists())

    def test_provider_digest_detects_manual_translation_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            en_path = root / "provider-configuration.mdx"
            zh_path = root / "provider-configuration.zh.mdx"
            en_path.write_text("provider source\n", encoding="utf-8")
            digest = translate.hashlib.sha256(en_path.read_bytes()).hexdigest()
            zh_path.write_text(
                f"{{/* terraform-source-sha256: {digest} */}}\n翻译\n",
                encoding="utf-8",
            )

            self.assertFalse(
                translate.provider_translation_is_outdated(en_path, zh_path)
            )
            en_path.write_text("updated provider source\n", encoding="utf-8")
            self.assertTrue(
                translate.provider_translation_is_outdated(en_path, zh_path)
            )


if __name__ == "__main__":
    unittest.main()
