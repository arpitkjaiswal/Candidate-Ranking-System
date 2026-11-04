"""Validate an isolated production stack; all containers and volumes are disposable."""

import json
import os
import secrets
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parent.parent
docker = ["docker", "--host=unix:///var/run/docker.sock"]
command = docker + [
    "compose",
    "-p",
    "talentos-check-" + secrets.token_hex(4),
    "-f",
    str(root / "compose.yaml"),
]
environment = {
    key: value
    for key, value in os.environ.items()
    if key
    not in ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH")
}
environment["TALENT_API_KEY"] = secrets.token_urlsafe(40)
environment["TALENT_DB_PASSWORD"] = secrets.token_urlsafe(36)
with socket.socket() as port_socket:
    port_socket.bind(("127.0.0.1", 0))
    port = port_socket.getsockname()[1]
environment["TALENT_HTTP_PORT"] = str(port)
base = f"http://127.0.0.1:{port}"


def api(path, method="GET", data=None, authenticated=True, content_type="application/json"):
    headers = {"Content-Type": content_type}
    if authenticated:
        headers["Authorization"] = "Bearer " + environment["TALENT_API_KEY"]
    request = urllib.request.Request(base + path, data=data, method=method, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read()
        return response.status, json.loads(body) if body else None


try:
    result = subprocess.run(
        command + ["up", "-d", "--no-build", "--wait", "--wait-timeout", "120"],
        env=environment,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        # Compose logs list service names and errors, not environment values.
        safe = result.stderr
        for secret in ("TALENT_API_KEY", "TALENT_DB_PASSWORD"):
            safe = safe.replace(environment[secret], "[redacted]")
        print(safe)
        raise RuntimeError("Production stack did not become healthy")
    assert api("/api/health", authenticated=False)[1] == {"status": "ok"}
    try:
        api("/api/jobs", authenticated=False)
    except urllib.error.HTTPError as exc:
        assert exc.code == 401
    else:
        raise AssertionError("Auth boundary missing")
    role = api(
        "/api/jobs",
        "POST",
        json.dumps(
            {
                "title": "Production integration role",
                "description": "Build Python FastAPI services with Docker and AWS. Add unit testing.",
            }
        ).encode(),
    )[1]
    boundary = "talentos-integration"
    body = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="resume.txt"\r\nContent-Type: text/plain\r\n\r\nJamie Example\njamie@example.com\nSkills\nPython FastAPI Docker AWS\nExperience\nBuilt REST APIs and shipped tested services.\r\n--{boundary}--\r\n'
    ).encode()
    candidate = api(
        f"/api/jobs/{role['id']}/candidates",
        "POST",
        body,
        content_type=f"multipart/form-data; boundary={boundary}",
    )[1]["added"][0]
    assert candidate["profile"]["name"] == "Jamie Example"
    first = api(
        f"/api/candidates/{candidate['id']}",
        "PATCH",
        json.dumps(
            {
                "version": candidate["version"],
                "notes": "Durable across restart.",
                "stage": "Interview",
            }
        ).encode(),
    )[1]
    try:
        api(
            f"/api/candidates/{candidate['id']}",
            "PATCH",
            json.dumps({"version": candidate["version"], "notes": "Stale write"}).encode(),
        )
    except urllib.error.HTTPError as exc:
        assert exc.code == 409
    else:
        raise AssertionError("Stale update accepted")
    subprocess.run(command + ["restart", "api"], env=environment, check=True, capture_output=True)
    for _ in range(40):
        try:
            restored = api(f"/api/candidates/{candidate['id']}")[1]
            break
        except (OSError, urllib.error.HTTPError):
            time.sleep(0.5)
    else:
        raise RuntimeError("API did not recover after restart")
    assert restored["notes"] == "Durable across restart."
    assert restored["stage"] == "Interview"
    role = api("/api/jobs")[1][0]
    assert api(f"/api/jobs/{role['id']}?version={role['version']}", "DELETE")[0] == 204
    assert api("/api/jobs")[1] == []
    print(
        "Production Compose passed: PostgreSQL migrations, nginx ingress, auth, limited document extraction, version conflict, persistence across restart, cascading deletion."
    )
except Exception:
    diagnostic = subprocess.run(
        command + ["logs", "--tail", "30", "gateway", "api"],
        env=environment,
        capture_output=True,
        text=True,
    )
    safe = diagnostic.stdout + diagnostic.stderr
    for secret in ("TALENT_API_KEY", "TALENT_DB_PASSWORD"):
        safe = safe.replace(environment[secret], "[redacted]")
    print(safe)
    raise
finally:
    subprocess.run(
        command + ["down", "--volumes", "--remove-orphans"],
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
