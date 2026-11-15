"""User-editable application settings, stored in the ``settings`` table (key -> JSON value).

Defaults come from the environment (``.env`` / ``EXOF_*``) where one exists. Overrides saved from the
Settings page are applied on top of the process-wide :func:`exofinder.config.get_settings` object
(see :func:`apply_overrides`), so lower layers that read ``get_settings()`` (e.g. downloads reading
``keep_raw_fits``) follow the UI without knowing about the database.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from exofinder.config import get_settings
from exofinder.db.models import Setting
from exofinder.db.session import session_scope


@dataclass(frozen=True)
class SettingSpec:
    key: str
    description: str
    kind: str  # "choice" | "int" | "bool" | "optional_int"
    choices: tuple[Any, ...] = ()
    minimum: int | None = None
    maximum: int | None = None
    env_attr: str | None = None  # attribute of config.Settings this overrides
    default: Any = None


SPECS: dict[str, SettingSpec] = {
    s.key: s
    for s in (
        SettingSpec(
            "device",
            "Compute device for training and inference. 'auto' uses a CUDA GPU when available.",
            "choice",
            choices=("auto", "cpu", "cuda", "mps"),
            env_attr="device",
        ),
        SettingSpec(
            "download_workers",
            "Parallel downloads from NASA MAST (be polite: 2-8).",
            "int",
            minimum=1,
            maximum=16,
            env_attr="download_workers",
        ),
        SettingSpec(
            "keep_raw_fits",
            "Keep raw FITS files after building the compact light-curve cache (uses much more disk).",
            "bool",
            env_attr="keep_raw_fits",
        ),
        SettingSpec(
            "default_model_id",
            "Model version used by default for predictions (None = the active model).",
            "optional_int",
            default=None,
        ),
        SettingSpec(
            "default_threshold_mode",
            "Decision threshold: 'validation_f1' (chosen on the validation set) or 'fixed_0.5'.",
            "choice",
            choices=("validation_f1", "fixed_0.5"),
            default="validation_f1",
        ),
        SettingSpec(
            "ui_density",
            "Table density in the interface.",
            "choice",
            choices=("comfortable", "compact"),
            default="comfortable",
        ),
        SettingSpec(
            "reduced_motion",
            "Animation preference: follow the operating system, or force on/off.",
            "choice",
            choices=("system", "on", "off"),
            default="system",
        ),
    )
}


_ENV_DEFAULTS: dict[str, Any] = {}
_CAPTURED_FOR: list[int] = []  # id() of the settings object the defaults were captured from


def defaults() -> dict[str, Any]:
    """Defaults: the environment's value (captured before any override is applied) or the spec's."""
    _capture_env_defaults()
    return {key: _ENV_DEFAULTS[key] if spec.env_attr else spec.default for key, spec in SPECS.items()}


def _capture_env_defaults() -> None:
    env = get_settings()
    if _CAPTURED_FOR and _CAPTURED_FOR[0] == id(env):
        return
    _CAPTURED_FOR[:] = [id(env)]
    _ENV_DEFAULTS.clear()
    for key, spec in SPECS.items():
        if spec.env_attr:
            _ENV_DEFAULTS[key] = getattr(env, spec.env_attr)


def descriptions() -> dict[str, dict[str, Any]]:
    return {
        k: {
            "description": s.description,
            "kind": s.kind,
            "choices": list(s.choices) or None,
            "minimum": s.minimum,
            "maximum": s.maximum,
        }
        for k, s in SPECS.items()
    }


def validate_value(key: str, value: Any) -> Any:
    """Return the normalised value or raise ``ValueError`` with a user-readable message."""
    spec = SPECS.get(key)
    if spec is None:
        raise ValueError(f"Unknown setting '{key}'. Known settings: {', '.join(sorted(SPECS))}")
    if spec.kind == "choice":
        if value not in spec.choices:
            raise ValueError(f"'{key}' must be one of {', '.join(map(str, spec.choices))} (got {value!r})")
        return value
    if spec.kind == "bool":
        if not isinstance(value, bool):
            raise ValueError(f"'{key}' must be true or false (got {value!r})")
        return value
    if spec.kind in ("int", "optional_int"):
        if value is None and spec.kind == "optional_int":
            return None
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f"'{key}' must be an integer (got {value!r})")
        if spec.minimum is not None and value < spec.minimum:
            raise ValueError(f"'{key}' must be at least {spec.minimum} (got {value})")
        if spec.maximum is not None and value > spec.maximum:
            raise ValueError(f"'{key}' must be at most {spec.maximum} (got {value})")
        return value
    raise ValueError(f"Unsupported setting kind {spec.kind!r}")  # pragma: no cover


def stored_overrides(session: Session) -> dict[str, Any]:
    return {row.key: row.value for row in session.query(Setting).all() if row.key in SPECS}


def get_all(session: Session) -> dict[str, Any]:
    _capture_env_defaults()
    values = defaults()
    values.update(stored_overrides(session))
    return values


def get_value(key: str, session: Session | None = None) -> Any:
    """Effective value of one setting (stored override, else default)."""
    if key not in SPECS:
        raise KeyError(key)
    if session is not None:
        return get_all(session)[key]
    with session_scope() as s:
        return get_all(s)[key]


def update(session: Session, changes: dict[str, Any]) -> dict[str, Any]:
    """Validate and store a partial update; returns the new effective values. All-or-nothing."""
    _capture_env_defaults()
    normalised = {k: validate_value(k, v) for k, v in changes.items()}
    for key, value in normalised.items():
        row = session.get(Setting, key)
        if row is None:
            session.add(Setting(key=key, value=value))
        else:
            row.value = value
    session.flush()
    values = get_all(session)
    apply_overrides(values)
    return values


def apply_overrides(values: dict[str, Any] | None = None) -> None:
    """Copy effective values onto the process-wide settings object (startup and after updates)."""
    _capture_env_defaults()
    if values is None:
        with session_scope() as s:
            values = get_all(s)
    env = get_settings()
    for key, spec in SPECS.items():
        if spec.env_attr and key in values:
            object.__setattr__(env, spec.env_attr, values[key])
