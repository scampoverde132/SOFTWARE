#!/usr/bin/env python3
"""WL PT TOOL — side-by-side Windows desktop entrypoint.

This entrypoint deliberately uses a separate executable name, localhost port,
pywebview storage profile, self-test log, and settings folder from PlanTakeoff.
"""
from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
import traceback
import urllib.request
from pathlib import Path

from wl_identity_server import APP_NAME, DEFAULT_PORT, webview_storage_dir

REQUIRED_UI_FILES = (
    "index.html",
    "js/models.js",
    "js/store.js",
    "js/history.js",
    "js/canvas-engine.js",
    "js/estimates.js",
    "js/job-model.js",
    "js/command-center.js",
    "js/productivity.js",
    "js/finalization.js",
    "js/change-order.js",
    "js/change-order-disk.js",
    "js/daily-logs.js",
    "js/daily-logs-local-date.js",
    "js/settings.js",
    "js/settings-model-defaults.js",
    "js/hardening.js",
    "js/client-updates.js",
    "js/wl-brand.js",
    "js/pdf-loader-core.js",
    "js/pdf-loader.js",
    "js/app.js",
)


def app_dir() -> Path:
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass and (Path(meipass) / "index.html").exists():
            return Path(meipass)
        base = Path(sys.executable).resolve().parent
        internal = base / "_internal"
        if (internal / "index.html").exists():
            return internal
        return base
    return Path(__file__).resolve().parent


def runtime_dir() -> Path:
    return Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent


def available_port(preferred: int, *, allow_fallback: bool) -> int:
    candidates = [preferred]
    if allow_fallback:
        candidates.extend(range(preferred + 1, preferred + 20))
        candidates.append(0)
    for port in candidates:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port if port else 0))
                return sock.getsockname()[1]
            except OSError:
                continue
    raise OSError(f"{APP_NAME} is already running or localhost port {preferred} is unavailable")


def start_server(root: Path, port: int):
    os.chdir(root)
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))

    import server as srv
    import job_server
    import daily_log_server
    import client_update_server
    import suite_server
    import wl_identity_server

    job_server.install(srv)
    daily_log_server.install(srv)
    client_update_server.install(srv)
    wl_identity_server.configure(suite_server, srv)
    suite_server.install(srv)

    srv.APP_DIR = root
    srv.PORT = port

    from http.server import ThreadingHTTPServer

    httpd = ThreadingHTTPServer(("127.0.0.1", port), srv.Handler)
    httpd.daemon_threads = True
    thread = threading.Thread(target=httpd.serve_forever, daemon=True, name="WLPTToolHTTP")
    thread.start()
    return httpd


def wait_ready(port: int, timeout: float = 12.0) -> bool:
    deadline = time.time() + timeout
    last_error = ""
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1.5) as response:
                if response.status == 200:
                    return True
        except Exception as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            time.sleep(0.2)
    wait_ready.last_error = last_error  # type: ignore[attr-defined]
    return False


def show_error(message: str) -> None:
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(0, message, APP_NAME, 0x10)
    except Exception:
        print(message, file=sys.stderr)


def json_get(port: int, path: str) -> dict:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5) as response:
        payload = json.loads(response.read().decode("utf-8"))
        if response.status != 200:
            raise RuntimeError(f"{path} returned HTTP {response.status}")
        return payload


def self_test(root: Path) -> int:
    log_path = runtime_dir() / "WL-PT-TOOL-self-test.log"
    httpd = None
    try:
        missing = [relative for relative in REQUIRED_UI_FILES if not (root / relative).is_file()]
        if missing:
            raise RuntimeError("Missing bundled UI files: " + ", ".join(missing))

        port = available_port(0, allow_fallback=True)
        httpd = start_server(root, port)
        if not wait_ready(port):
            raise RuntimeError(getattr(wait_ready, "last_error", "") or "Local server did not become ready")

        config = json_get(port, "/api/config")
        settings = json_get(port, "/api/suite/settings")
        if not config.get("bids_root"):
            raise RuntimeError("/api/config did not return bids_root")
        if not settings.get("ok") or not isinstance(settings.get("settings"), dict):
            raise RuntimeError("/api/suite/settings did not return valid settings")
        if "WL PT TOOL" not in str(settings.get("settingsFile") or ""):
            raise RuntimeError("Settings are not isolated under the WL PT TOOL profile")

        result = {
            "ok": True,
            "product": APP_NAME,
            "checkedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
            "appRoot": str(root),
            "bidsRoot": config.get("bids_root"),
            "settingsFile": settings.get("settingsFile"),
            "requiredUiFiles": len(REQUIRED_UI_FILES),
        }
        log_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        return 0
    except Exception:
        log_path.write_text(f"{APP_NAME} standalone self-test failed\n\n" + traceback.format_exc(), encoding="utf-8")
        return 1
    finally:
        if httpd is not None:
            try:
                httpd.shutdown()
            except Exception:
                pass


def main() -> int:
    root = app_dir()
    os.chdir(root)

    if "--self-test" in sys.argv[1:]:
        return self_test(root)

    if not os.environ.get("PLANTAKEOFF_BIDS_ROOT"):
        default_bids = Path.home() / "OneDrive" / "Desktop" / "Samuel Bids"
        if default_bids.is_dir():
            os.environ["PLANTAKEOFF_BIDS_ROOT"] = str(default_bids)

    try:
        port = available_port(DEFAULT_PORT, allow_fallback=False)
        httpd = start_server(root, port)
    except Exception:
        show_error(
            f"Could not start {APP_NAME}.\n\n{traceback.format_exc()}\n"
            f"The existing PlanTakeoff app uses a different port and is not changed."
        )
        return 1

    if not wait_ready(port):
        detail = getattr(wait_ready, "last_error", "") or "no response"
        try:
            httpd.shutdown()
        except Exception:
            pass
        show_error(f"{APP_NAME} server did not become ready on port {port}.\n\n{detail}")
        return 1

    url = f"http://127.0.0.1:{port}/index.html"
    try:
        import webview
    except ImportError:
        import webbrowser

        webbrowser.open(url)
        show_error(f"pywebview is not installed. {APP_NAME} opened in the default browser instead.")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        httpd.shutdown()
        return 0

    window = webview.create_window(
        title=f"{APP_NAME} — WL Painting",
        url=url,
        width=1440,
        height=900,
        min_size=(1024, 700),
        background_color="#0d1b2a",
        text_select=True,
    )

    def apply_brand() -> None:
        try:
            window.evaluate_js(
                "if(!document.querySelector('script[data-wl-brand]')){"
                "const s=document.createElement('script');s.src='js/wl-brand.js';"
                "s.dataset.wlBrand='1';document.head.appendChild(s);}" 
            )
        except Exception:
            pass

    def on_closed() -> None:
        try:
            httpd.shutdown()
        except Exception:
            pass

    try:
        window.events.loaded += apply_brand
        window.events.closed += on_closed
    except Exception:
        pass

    webview.start(
        debug=False,
        private_mode=False,
        storage_path=str(webview_storage_dir()),
    )
    try:
        httpd.shutdown()
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
