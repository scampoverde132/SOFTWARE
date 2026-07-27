# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for PlanTakeoff desktop
import sys
from pathlib import Path

ROOT = Path(SPECPATH)

datas = [
    (str(ROOT / "index.html"), "."),
    (str(ROOT / "css"), "css"),
    (str(ROOT / "js"), "js"),
    (str(ROOT / "vendor"), "vendor"),
    (str(ROOT / "extensions"), "extensions"),
    # js/ includes scope-logic.js via folder copy
    (str(ROOT / "server.py"), "."),
    (str(ROOT / "README.md"), "."),
]
# All js/*.js under js/ are included via the js folder above (incl. history.js).

a = Analysis(
    [str(ROOT / "desktop_app.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=[
        "server",
        "job_server",
        "webview",
        "webview.platforms.edgechromium",
        "clr",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="PlanTakeoff",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,  # windowed app — no black console
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(ROOT / "assets" / "icon.ico") if (ROOT / "assets" / "icon.ico").exists() else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="PlanTakeoff",
)
