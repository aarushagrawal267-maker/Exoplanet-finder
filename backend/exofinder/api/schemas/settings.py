"""Schemas for settings, storage management and research documentation pages."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from exofinder.api.schemas.common import UtcDatetime


class SettingDescription(BaseModel):
    description: str
    kind: str = Field(description="choice | int | bool | optional_int")
    choices: list[Any] | None = None
    minimum: int | None = None
    maximum: int | None = None


class SettingsOut(BaseModel):
    values: dict[str, Any] = Field(description="Effective values (stored override, else default)")
    defaults: dict[str, Any]
    descriptions: dict[str, SettingDescription]


class StorageCategory(BaseModel):
    key: str
    label: str
    path: str
    bytes: int
    n_files: int
    clearable: bool
    description: str


class DiskInfo(BaseModel):
    path: str
    total: int
    used: int
    free: int


class StorageOut(BaseModel):
    categories: list[StorageCategory]
    total_bytes: int
    disk: DiskInfo | None = None


class ClearIn(BaseModel):
    target: Literal["raw_fits", "uploads", "views_cache"]


class ClearOut(BaseModel):
    target: str
    bytes_freed: int
    files_removed: int
    path: str


class DocPageSummary(BaseModel):
    slug: str
    title: str
    size_bytes: int
    updated_at: UtcDatetime


class DocPage(BaseModel):
    slug: str
    title: str
    markdown: str
