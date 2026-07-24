"""Loads config.yaml and exposes typed settings used across the application."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel

_CONFIG_PATH = Path(__file__).parent.parent / "config.yaml"


class CountyConfig(BaseModel):
    name: str
    state: str
    fips: str


class BufferDefaults(BaseModel):
    wetland_ft: float
    floodplain_ft: float
    easement_ft: float
    building_ft: float
    parcel_boundary_ft: float = 0.0


class ConstraintLayerMeta(BaseModel):
    name: str
    type: str
    default_buffer_ft: float
    source: str


class AppConfig(BaseModel):
    buffers: BufferDefaults
    county: CountyConfig
    working_crs: str
    constraint_layers: list[ConstraintLayerMeta]

    # Paths derived at load time — not in YAML.
    processed_dir: Path = Path("data/processed")

    model_config = {"arbitrary_types_allowed": True}


@lru_cache(maxsize=1)
def get_config() -> AppConfig:
    raw: dict[str, Any] = yaml.safe_load(_CONFIG_PATH.read_text())

    # Resolve processed_dir relative to repo root (two levels above app/).
    repo_root = Path(__file__).parent.parent.parent.parent
    processed_dir = repo_root / "data" / "processed"

    return AppConfig(
        buffers=BufferDefaults(**raw["buffers"]),
        county=CountyConfig(**raw["county"]),
        working_crs=raw["working_crs"],
        constraint_layers=[ConstraintLayerMeta(**l) for l in raw["constraint_layers"]],
        processed_dir=processed_dir,
    )
