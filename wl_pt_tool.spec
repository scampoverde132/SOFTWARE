# -*- mode: python ; coding: utf-8 -*-
# Side-by-side PyInstaller spec for WL PT TOOL.
from pathlib import Path

ROOT = Path(SPECPATH)

datas = [
    (str(ROOT / "index.html"), "."),
    (str(ROOT / "css"), "css"),
    (str(ROOT / "js"), "js"),
    (str(ROOT / "vendor"), "vendor"),
    (str(ROOT / "extensions"), "extensions"),
    (str(ROOT / "server.py"), "."),
    (str(ROOT / "README.md"), "."),
    (str(ROOT / "WL-PT-TOOL-INSTALL.txt"), "."),
]

a = Analysis(
    [str(ROOT / "wl_pt_tool_app.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=[
        "server",
        "job_server",
        "daily_log_server",
        "client_update_server",
        "suite_server",
        "wl_identity_server",
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
    name="WL PT TOOL",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
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
    name="WL PT TOOL",
)
