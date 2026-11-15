"""Research documentation pages served to the UI (``/api/docs/pages``).

Pages are the Markdown files directly inside the repository's ``docs/`` folder (not ``docs/dev/``,
which holds developer specifications, and not the development progress log). The slug is the file
stem; the title is the first Markdown heading. Slugs are validated and resolved strictly inside
``docs/``, so no other file can be read.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from exofinder.config import REPO_ROOT
from exofinder.services.sci_errors import not_found

DOCS_DIR = REPO_ROOT / "docs"
#: Developer-internal files in docs/ that are not research documentation.
EXCLUDED = {"DEV_PROGRESS"}
#: Preferred reading order; other pages follow alphabetically.
ORDER = ("methodology", "data-sources", "limitations", "research-report-template")
_SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$")


def _docs_dir() -> Path:
    return DOCS_DIR


def _excluded(stem: str) -> bool:
    # Case-insensitive: on Windows (and macOS) "dev_progress" opens DEV_PROGRESS.md.
    return stem.upper() in {e.upper() for e in EXCLUDED}


def _title(text: str, slug: str) -> str:
    for line in text.splitlines():
        m = re.match(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$", line)
        if m:
            return m.group(1).strip()
    return slug.replace("-", " ").replace("_", " ").capitalize()


def _pages() -> list[Path]:
    d = _docs_dir()
    if not d.is_dir():
        return []
    files = [p for p in d.glob("*.md") if p.is_file() and not _excluded(p.stem) and _SLUG_RE.match(p.stem)]
    rank = {s: i for i, s in enumerate(ORDER)}
    return sorted(files, key=lambda p: (rank.get(p.stem, len(ORDER)), p.stem.lower()))


def list_pages() -> list[dict[str, Any]]:
    out = []
    for p in _pages():
        text = p.read_text("utf-8", errors="replace")
        st = p.stat()
        out.append(
            {
                "slug": p.stem,
                "title": _title(text, p.stem),
                "size_bytes": st.st_size,
                "updated_at": datetime.fromtimestamp(st.st_mtime, UTC).replace(tzinfo=None),
            }
        )
    return out


def get_page(slug: str) -> dict[str, Any]:
    if not isinstance(slug, str) or not _SLUG_RE.match(slug) or _excluded(slug):
        raise not_found(f"Documentation page '{slug}'", "doc_not_found")
    d = _docs_dir().resolve()
    path = (d / f"{slug}.md").resolve()
    if path.parent != d or not path.is_file():
        raise not_found(
            f"Documentation page '{slug}'", "doc_not_found", "List pages with GET /api/docs/pages."
        )
    text = path.read_text("utf-8", errors="replace")
    return {"slug": slug, "title": _title(text, slug), "markdown": text}
