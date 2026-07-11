# Shared plumbing for redpen's browser tests. Plain module — no pytest, no
# dependencies beyond playwright itself.
#
# serve_repo(): context manager that serves the repo root on an ephemeral
# port and yields the URL of index.html.
# launch_browser(p): headless Chromium; honors REDPEN_CHROMIUM for an
# explicit executable path (e.g. sandboxes with a pre-installed browser).

import contextlib
import functools
import http.server
import os
import threading

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@contextlib.contextmanager
def serve_repo():
    handler = functools.partial(_QuietHandler, directory=REPO_ROOT)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield "http://127.0.0.1:%d/index.html" % server.server_address[1]
    finally:
        server.shutdown()


def launch_browser(p):
    kwargs = {"headless": True}
    exe = os.environ.get("REDPEN_CHROMIUM")
    if exe:
        kwargs["executable_path"] = exe
    return p.chromium.launch(**kwargs)


def fixture_path(name):
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", name)
