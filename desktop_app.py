#!/usr/bin/env python3
"""
PlanTakeoff Desktop — native Windows application shell.

Runs the embedded local server + web UI in a dedicated window (pywebview).
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
    "js/hardening.js",
    "js/client-updates.js",
    "js/pdf-loader-core.js",
    "js/pdf-loader.js",
    "js/app.js",
)


def app_dir() -> Path:
    """Directory that holds index.html, js/, css/, server.py (dev or frozen)."""
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
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def free_port(preferred: int = 8765) -> int:
    """Pick a free localhost port. Prefer 8765; fall back to ephemeral."""
    candidates = [preferred] + list(range(preferred + 1, preferred + 20)) + [0]
    for port in candidates:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port if port else 0))
                return sock.getsockname()[1]
            except OSError:
                continue
    raise OSError("No free localhost port for PlanTakeoff")


def start_server(root: Path, port: int):
    """Import and run PlanTakeoff HTTP server on given port."""
    os.chdir(root)
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))

    import server as srv
    import job_server
    import daily_log_server
    import client_update_server
    import suite_server

    job_server.install(srv)
    daily_log_server.install(srv)
    client_update_server.install(srv)
    suite_server.install(srv)

    srv.APP_DIR = root
    srv.PORT = port

    from http.server import ThreadingHTTPServer

    httpd = ThreadingHTTPServer(("127.0.0.1", port), srv.Handler)
    httpd.daemon_threads = True
    thread = threading.Thread(target=httpd.serve_forever, daemon=True, name="PlanTakeoffHTTP")
    thread.start()
    return httpd


def wait_ready(port: int, timeout: float = 12.0) -> bool:
    url = f"http://127.0.0.1:{port}/api/health"
    deadline = time.time() + timeout
    last_err = ""
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.5) as response:
                if response.status == 200:
                    return True
        except Exception as exc:
            last_err = f"{type(exc).__name__}: {exc}"
            time.sleep(0.2)
    wait_ready.last_error = last_err  # type: ignore[attr-defined]
    return False


def show_error(message: str):
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(0, message, "PlanTakeoff", 0x10)
    except Exception:
        print(message, file=sys.stderr)


def _json_get(port: int, path: str) -> dict:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5) as response:
        payload = json.loads(response.read().decode("utf-8"))
        if response.status != 200:
            raise RuntimeError(f"{path} returned HTTP {response.status}")
        return payload


def self_test(root: Path) -> int:
    """Validate bundled files and the full local server stack without opening a window."""
    log_path = runtime_dir() / "PlanTakeoff-self-test.log"
    httpd = None
    try:
        missing = [relative for relative in REQUIRED_UI_FILES if not (root / relative).is_file()]
        if missing:
            raise RuntimeError("Missing bundled UI files: " + ", ".join(missing))

        port = free_port(0)
        httpd = start_server(root, port)
        if not wait_ready(port, timeout=12):
            detail = getattr(wait_ready, "last_error", "") or "no response"
            raise RuntimeError(f"Local server did not become ready: {detail}")

        config = _json_get(port, "/api/config")
        settings = _json_get(port, "/api/suite/settings")
        if not config.get("bids_root"):
            raise RuntimeError("/api/config did not return bids_root")
        if not settings.get("ok") or not isinstance(settings.get("settings"), dict):
            raise RuntimeError("/api/suite/settings did not return valid settings")

        result = {
            "ok": True,
            "checkedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
            "appRoot": str(root),
            "bidsRoot": config.get("bids_root"),
            "requiredUiFiles": len(REQUIRED_UI_FILES),
        }
        log_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        return 0
    except Exception:
        log_path.write_text(
            "PlanTakeoff standalone self-test failed\n\n" + traceback.format_exc(),
            encoding="utf-8",
        )
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

    port = free_port(8765)
    try:
        httpd = start_server(root, port)
    except Exception:
        show_error("Could not start PlanTakeoff server:\n\n" + traceback.format_exc())
        return 1

    if not wait_ready(port):
        detail = getattr(wait_ready, "last_error", "") or "no response"
        try:
            httpd.shutdown()
        except Exception:
            pass
        show_error(
            f"Server started but did not become ready on port {port}.\n"
            f"Detail: {detail}\n\n"
            "Close other PlanTakeoff windows and try again.\n"
            "If it keeps failing, run: Launch PlanTakeoff.bat"
        )
        return 1

    url = f"http://127.0.0.1:{port}/index.html"

    try:
        import webview
    except ImportError:
        import webbrowser

        webbrowser.open(url)
        show_error(
            "pywebview is not installed — opened in your browser instead.\n"
            "For the desktop window, reinstall PlanTakeoff or run:\n"
            "  pip install pywebview"
        )
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        httpd.shutdown()
        return 0

    window = webview.create_window(
        title="PlanTakeoff — WL Painting",
        url=url,
        width=1440,
        height=900,
        min_size=(1024, 700),
        background_color="#0d1b2a",
        text_select=True,
    )

    def on_closed():
        try:
            httpd.shutdown()
        except Exception:
            pass

    try:
        window.events.closed += on_closed
    except Exception:
        pass

    webview.start(debug=False)
    try:
        httpd.shutdown()
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
