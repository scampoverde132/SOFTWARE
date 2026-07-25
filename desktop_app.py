#!/usr/bin/env python3
"""
PlanTakeoff Desktop — native Windows application shell.

Runs the embedded local server + web UI in a dedicated window (pywebview).
"""
from __future__ import annotations

import os
import socket
import sys
import threading
import time
import traceback
from pathlib import Path


def app_dir() -> Path:
    """Directory that holds index.html, js/, css/, server.py (dev or frozen)."""
    if getattr(sys, "frozen", False):
        # PyInstaller onedir: bundled data is in _MEIPASS (_internal)
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass and (Path(meipass) / "index.html").exists():
            return Path(meipass)
        base = Path(sys.executable).resolve().parent
        internal = base / "_internal"
        if (internal / "index.html").exists():
            return internal
        return base
    return Path(__file__).resolve().parent


def free_port(preferred: int = 8765) -> int:
    """Pick a free localhost port. Prefer 8765; fall back to ephemeral."""
    candidates = [preferred] + list(range(preferred + 1, preferred + 20)) + [0]
    for port in candidates:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port if port else 0))
                return s.getsockname()[1]
            except OSError:
                continue
    raise OSError("No free localhost port for PlanTakeoff")


def start_server(root: Path, port: int):
    """Import and run PlanTakeoff HTTP server on given port."""
    os.chdir(root)
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))

    # Configure server module before import side-effects
    import server as srv

    srv.APP_DIR = root
    srv.PORT = port

    from http.server import ThreadingHTTPServer

    httpd = ThreadingHTTPServer(("127.0.0.1", port), srv.Handler)
    httpd.daemon_threads = True
    thread = threading.Thread(target=httpd.serve_forever, daemon=True, name="PlanTakeoffHTTP")
    thread.start()
    return httpd


def wait_ready(port: int, timeout: float = 12.0) -> bool:
    import urllib.request
    import urllib.error

    url = f"http://127.0.0.1:{port}/api/health"
    deadline = time.time() + timeout
    last_err = ""
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.5) as r:
                if r.status == 200:
                    return True
        except Exception as exc:
            last_err = f"{type(exc).__name__}: {exc}"
            time.sleep(0.2)
    # Store for diagnostics
    wait_ready.last_error = last_err  # type: ignore[attr-defined]
    return False


def show_error(msg: str):
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(0, msg, "PlanTakeoff", 0x10)
    except Exception:
        print(msg, file=sys.stderr)


def main() -> int:
    root = app_dir()
    os.chdir(root)

    # Allow override of bids root via env (set by launcher/installer)
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
        # Fallback: open default browser and keep process alive
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
