#!/usr/bin/env python3
"""WL PT TOOL product identity and isolated local settings location."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

APP_NAME = "WL PT TOOL"
APP_DATA_FOLDER = "WL PT TOOL"
DEFAULT_PORT = 8876


def data_root() -> Path:
    """Return a user-writable folder isolated from the existing PlanTakeoff app."""
    local = os.environ.get("LOCALAPPDATA", "").strip()
    root = Path(local) / APP_DATA_FOLDER if local else Path.home() / ".wl-pt-tool"
    root.mkdir(parents=True, exist_ok=True)
    return root


def settings_dir() -> Path:
    root = data_root()
    root.mkdir(parents=True, exist_ok=True)
    return root


def webview_storage_dir() -> Path:
    root = data_root() / "WebView"
    root.mkdir(parents=True, exist_ok=True)
    return root


def configure(suite_server_module: Any, server_module: Any | None = None) -> None:
    """Patch only the new WL PT TOOL process before suite_server is installed."""
    suite_server_module.settings_dir = settings_dir
    if server_module is not None:
        server_module.APP_PRODUCT_NAME = APP_NAME
        server_module.APP_DATA_ROOT = str(data_root())
