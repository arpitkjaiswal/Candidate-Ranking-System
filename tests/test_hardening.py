import asyncio
import io
import json
import subprocess
import threading
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm.exc import StaleDataError

from backend import documents
from backend.database import Activity, Candidate, Job
from backend.http_limits import RequestBodyLimit
from backend.schema import upgrade_schema


def add_candidate(client, role, resume):
    return client.post(
        f"/api/jobs/{role['id']}/candidates", files={"files": ("resume.txt", resume)}
    ).json()["added"][0]


def test_stale_candidate_save_does_not_overwrite_notes(client, role, resume):
    candidate = add_candidate(client, role, resume)
    path = f"/api/candidates/{candidate['id']}"
    first = client.patch(
        path, json={"version": candidate["version"], "notes": "First reviewer saved this."}
    ).json()
    assert first["version"] == candidate["version"] + 1
    stale = client.patch(path, json={"version": candidate["version"], "notes": "Stale draft"})
    assert stale.status_code == 409
    assert client.get(path).json()["notes"] == "First reviewer saved this."
    assert client.delete(path, params={"version": candidate["version"]}).status_code == 409
    assert client.patch(path, json={"notes": "No revision"}).status_code == 422


def test_database_rejects_concurrent_writers(client, role, resume):
    candidate = add_candidate(client, role, resume)
    with client.app.state.sessions() as first, client.app.state.sessions() as second:
        a = first.get(Candidate, candidate["id"])
        b = second.get(Candidate, candidate["id"])
        a.notes = "Committed"
        first.commit()
        b.notes = "Must not overwrite"
        with pytest.raises(StaleDataError):
            second.commit()


def test_role_edit_rescores_and_cascading_delete(client, role, resume):
    candidate = add_candidate(client, role, resume)
    role = client.get("/api/jobs").json()[0]
    updated = client.put(
        f"/api/jobs/{role['id']}",
        json={
            **{
                key: role[key]
                for key in (
                    "title",
                    "department",
                    "location",
                    "description",
                    "required_skills",
                    "version",
                )
            },
            "required_skills": ["Java"],
        },
    )
    assert updated.status_code == 200
    assert updated.json()["version"] == role["version"] + 1
    rescored = client.get(f"/api/candidates/{candidate['id']}").json()
    assert rescored["report"]["matched_skills"] == []
    assert rescored["report"]["missing_skills"] == ["Java"]
    assert rescored["version"] > candidate["version"]
    assert client.delete(f"/api/jobs/{role['id']}?version=1").status_code == 409
    assert (
        client.delete(f"/api/jobs/{role['id']}?version={updated.json()['version']}").status_code
        == 204
    )
    assert client.get("/api/jobs").json() == []
    with client.app.state.sessions() as session:
        assert session.scalar(select(Candidate.id)) is None
        assert session.scalar(select(Activity.id)) is None


def small_limit_app():
    app = FastAPI()
    app.add_middleware(RequestBodyLimit, max_bytes=16)

    @app.post("/echo")
    async def echo(request: Request):
        return {"size": len(await request.body())}

    return app


@pytest.mark.parametrize("length", ["17", "-1", "invalid"])
def test_content_length_rejected_before_body(length):
    with TestClient(small_limit_app()) as client:
        response = client.post("/echo", content=b"x", headers={"Content-Length": length})
        assert response.status_code == (413 if length == "17" else 400)


def test_chunked_request_limit():
    async def check():
        messages = [
            {"type": "http.request", "body": b"a" * 10, "more_body": True},
            {"type": "http.request", "body": b"b" * 10, "more_body": False},
        ]
        sent = []

        async def receive():
            return messages.pop(0)

        async def send(message):
            sent.append(message)

        async def app(scope, receive, send):
            while (await receive()).get("more_body"):
                pass

        await RequestBodyLimit(app, max_bytes=16)({"type": "http", "headers": []}, receive, send)
        assert sent[0]["status"] == 413

    asyncio.run(check())


def test_worker_limits_extracted_text(client):
    response = client.post("/api/parse", files={"file": ("large-text.txt", b"a" * 200001)})
    assert response.status_code == 413
    assert "200,000" in response.json()["detail"]


def test_worker_timeout_releases_capacity(monkeypatch):
    semaphore = threading.BoundedSemaphore(1)
    monkeypatch.setattr(documents, "WORKERS", semaphore)

    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired("worker", 12)

    monkeypatch.setattr(documents.subprocess, "run", timeout)
    with pytest.raises(HTTPException, match="timed out"):
        documents.read_resume(
            UploadFile(filename="resume.txt", file=io.BytesIO(b"Jane Doe Python"))
        )
    assert semaphore.acquire(blocking=False)
    semaphore.release()


def test_worker_saturation_is_reported(monkeypatch):
    monkeypatch.setattr(documents, "WORKERS", threading.BoundedSemaphore(0))
    with pytest.raises(HTTPException) as error:
        documents.read_resume(
            UploadFile(filename="resume.txt", file=io.BytesIO(b"Jane Doe Python"))
        )
    assert error.value.status_code == 503


def test_worker_does_not_inherit_credentials(monkeypatch):
    monkeypatch.setenv("TALENT_API_KEY", "test-credential-never-pass-to-workers")
    original = documents.subprocess.run
    captured = {}

    def checked(*args, **kwargs):
        captured.update(kwargs["env"])
        return original(*args, **kwargs)

    monkeypatch.setattr(documents.subprocess, "run", checked)
    profile, _ = documents.read_resume(
        UploadFile(filename="resume.txt", file=io.BytesIO(b"Jane Doe\nPython FastAPI"))
    )
    assert profile["name"] == "Jane Doe"
    assert "TALENT_API_KEY" not in captured
    assert "DATABASE_URL" not in captured


def test_verified_legacy_migration_preserves_data(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    config = Config()
    config.set_main_option(
        "script_location", str(Path(__file__).resolve().parent.parent / "migrations")
    )
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "0001")
        connection.execute(
            text(
                "INSERT INTO jobs VALUES ('keep','Legacy role','Engineering','Remote','Python backend engineering',:skills,'2026-11-04')"
            ),
            {"skills": json.dumps(["Python"])},
        )
        connection.exec_driver_sql("DROP TABLE alembic_version")
    upgrade_schema(engine)
    upgrade_schema(engine)
    with engine.connect() as connection:
        assert connection.execute(text("SELECT title,version FROM jobs")).one() == (
            "Legacy role",
            1,
        )
        assert (
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar() == "0002"
        )
    engine.dispose()


def test_unknown_legacy_schema_is_not_stamped(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'unknown.db'}")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE jobs (id TEXT)")
    with pytest.raises(RuntimeError, match="unknown schema"):
        upgrade_schema(engine)
    with engine.connect() as connection:
        assert (
            connection.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE name='alembic_version'"
            ).first()
            is None
        )
    engine.dispose()


def test_role_change_during_upload_rejects_entire_batch(client, role, resume, monkeypatch):
    from backend import main

    original = main.read_resume

    def changing(file):
        parsed = original(file)
        with client.app.state.sessions() as session:
            stored = session.get(Job, role["id"])
            stored.description = "Requirements changed while extracting the document."
            session.commit()
        return parsed

    monkeypatch.setattr(main, "read_resume", changing)
    response = client.post(
        f"/api/jobs/{role['id']}/candidates", files={"files": ("resume.txt", resume)}
    )
    assert response.status_code == 409
    assert client.get(f"/api/jobs/{role['id']}/candidates").json()["total"] == 0
