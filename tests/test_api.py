import io
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from docx import Document
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from backend.main import create_app


def test_health_and_security_headers(client):
    response = client.get("/api/health")
    assert response.json() == {"status": "ok"}
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-request-id"]
    assert client.get("/api/jobs").json() == []


def test_end_to_end_recruiter_workflow(client, role, resume):
    path = f"/api/jobs/{role['id']}/candidates"
    response = client.post(path, files=[("files", ("resume.txt", resume, "text/plain"))])
    assert response.status_code == 201
    candidate = response.json()["added"][0]
    assert candidate["profile"]["name"] == "Jane Doe"
    assert "raw_text" not in candidate["profile"]
    assert candidate["report"]["skill_match_pct"] == 100
    assert candidate["report"]["score"] >= 65
    assert candidate["report"]["evidence"]
    candidate_id = candidate["id"]
    updated = client.patch(
        f"/api/candidates/{candidate_id}",
        json={
            "stage": "Interview",
            "notes": "Discuss reliability tradeoffs.",
            "version": candidate["version"],
        },
    ).json()
    assert updated["stage"] == "Interview"
    assert updated["notes"] == "Discuss reliability tradeoffs."
    assert client.get(path).json()["total"] == 1
    assert client.get("/api/jobs").json()[0]["candidate_count"] == 1
    guide = client.get(f"/api/candidates/{candidate_id}/interview").json()
    assert len(guide["questions"]) >= 3
    assert "no language model" in guide["source"]
    exported = client.get(f"/api/jobs/{role['id']}/export")
    assert exported.status_code == 200
    assert "Jane Doe" in exported.text
    assert "Interview" in exported.text
    with TestClient(create_app()) as restored:
        persisted = restored.get(path).json()["items"][0]
        assert persisted["notes"] == "Discuss reliability tradeoffs."
    assert (
        client.delete(f"/api/candidates/{candidate_id}?version={updated['version']}").status_code
        == 204
    )
    assert client.get(path).json()["total"] == 0
    assert (
        client.patch(
            f"/api/candidates/{candidate_id}", json={"stage": "New", "version": 1}
        ).status_code
        == 404
    )
    assert len(client.get(f"/api/jobs/{role['id']}/activity").json()) == 4


def test_batch_partial_failure_and_duplicate(client, role, resume):
    path = f"/api/jobs/{role['id']}/candidates"
    files = [
        ("files", ("a.txt", resume)),
        ("files", ("b.exe", b"bad")),
        ("files", ("duplicate.txt", resume)),
    ]
    result = client.post(path, files=files).json()
    assert len(result["added"]) == 1
    assert len(result["errors"]) == 2
    assert "already" in result["errors"][1]["detail"]
    assert client.get(path).json()["total"] == 1


@pytest.mark.parametrize(
    "filename,data,status",
    [
        ("empty.txt", b"", 400),
        ("wrong.exe", b"bad", 400),
        ("bad.pdf", b"not a PDF", 422),
        ("large.txt", b"x" * (5 * 1024 * 1024 + 1), 413),
        ("space.txt", b"   ", 422),
    ],
)
def test_upload_validation(client, filename, data, status):
    assert client.post("/api/parse", files={"file": (filename, data)}).status_code == status


def test_docx_extraction(client, resume):
    document = Document()
    for line in resume.decode().splitlines():
        document.add_paragraph(line)
    stream = io.BytesIO()
    document.save(stream)
    response = client.post("/api/parse", files={"file": ("resume.docx", stream.getvalue())})
    assert response.status_code == 200
    assert response.json()["email"] == "jane.doe@example.com"
    assert "Python" in response.json()["skills"]


def test_pdf_preserves_email(client):
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})}
    )
    stream = DecodedStreamObject()
    stream.set_data(
        b"BT /F1 12 Tf 50 750 Td (Jane Doe) Tj 0 -20 Td (jane.doe@example.com) Tj 0 -20 Td (Python FastAPI Docker) Tj ET"
    )
    page[NameObject("/Contents")] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    response = client.post("/api/parse", files={"file": ("resume.pdf", output.getvalue())})
    assert response.status_code == 200
    assert response.json()["email"] == "jane.doe@example.com"
    assert "FastAPI" in response.json()["skills"]


def test_docx_expansion_limit(client):
    output = io.BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", b"a" * (21 * 1024 * 1024))
    assert (
        client.post("/api/parse", files={"file": ("bomb.docx", output.getvalue())}).status_code
        == 413
    )


def test_candidate_lab_does_not_persist(client, resume):
    response = client.post(
        "/api/match",
        files={"file": ("resume.txt", resume)},
        data={"job_description": "Python FastAPI Docker AWS services and REST APIs."},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["match"]["skill_match_pct"] == 100
    assert body["interview"]
    assert "raw_text" not in body["resume"]
    assert client.get("/api/jobs").json() == []


@pytest.mark.parametrize(
    "body",
    [
        {"title": "x", "description": "too short"},
        {"title": "Valid role", "description": "a" * 35, "required_skills": ["Magic unicorn AI"]},
        {"title": "   ", "description": "a" * 35},
    ],
)
def test_role_validation(client, body):
    assert client.post("/api/jobs", json=body).status_code == 422


def test_invalid_stage_and_missing_role(client, role, resume):
    assert (
        client.post(
            "/api/jobs/missing/candidates", files={"files": ("resume.txt", resume)}
        ).status_code
        == 404
    )
    candidate = client.post(
        f"/api/jobs/{role['id']}/candidates", files={"files": ("resume.txt", resume)}
    ).json()["added"][0]
    assert (
        client.patch(
            f"/api/candidates/{candidate['id']}", json={"stage": "Auto-reject"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/match", files={"file": ("resume.txt", resume)}, data={"job_description": "   "}
        ).status_code
        == 400
    )


def test_shared_workspace_authentication(tmp_path, monkeypatch):
    monkeypatch.setenv("TALENT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("TALENT_DEMO", "0")
    monkeypatch.setenv("TALENT_API_KEY", "test-key-for-isolated-automated-test")
    with TestClient(create_app()) as client:
        assert client.get("/api/meta").json()["auth_required"]
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/jobs").status_code == 401
        assert client.get("/api/docs").status_code == 401
        assert client.get("/api/jobs", headers={"Authorization": "Bearer wrong"}).status_code == 401
        assert (
            client.get(
                "/api/jobs",
                headers={"Authorization": "Bearer test-key-for-isolated-automated-test"},
            ).status_code
            == 200
        )


def test_production_requires_auth(monkeypatch):
    monkeypatch.setenv("TALENT_ENV", "production")
    monkeypatch.delenv("TALENT_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="TALENT_API_KEY"):
        create_app()


def test_rate_limit(client):
    for _ in range(120):
        assert client.get("/api/skills").status_code == 200
    response = client.get("/api/skills")
    assert response.status_code == 429
    assert response.headers["retry-after"] == "60"


def test_role_infers_visible_requirements(client):
    response = client.post(
        "/api/jobs",
        json={
            "title": "Platform engineer",
            "description": "Build Python FastAPI services with Docker and AWS. Maintain unit testing.",
        },
    )
    assert response.status_code == 201
    assert set(response.json()["required_skills"]) == {
        "Python",
        "FastAPI",
        "Docker",
        "AWS",
        "Testing",
    }


def test_csv_formula_injection_is_escaped(client, role, resume):
    from backend.database import Candidate

    candidate = client.post(
        f"/api/jobs/{role['id']}/candidates", files={"files": ("resume.txt", resume)}
    ).json()["added"][0]
    with client.app.state.sessions() as session:
        stored = session.get(Candidate, candidate["id"])
        stored.profile = {**stored.profile, "name": '=HYPERLINK("https://example.com")'}
        session.commit()
    exported = client.get(f"/api/jobs/{role['id']}/export")
    import csv

    rows = list(csv.reader(io.StringIO(exported.text)))
    assert rows[1][0].startswith("'=HYPERLINK")
