import pytest
from fastapi.testclient import TestClient

from backend.main import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TALENT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("TALENT_DEMO", "0")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("TALENT_API_KEY", raising=False)
    monkeypatch.delenv("TALENT_ENV", raising=False)
    with TestClient(create_app()) as client:
        yield client


@pytest.fixture
def role(client):
    response = client.post(
        "/api/jobs",
        json={
            "title": "Backend Engineer",
            "description": "Build Python FastAPI REST APIs and deploy Docker services on AWS.",
            "required_skills": ["Python", "FastAPI", "Docker", "AWS"],
        },
    )
    assert response.status_code == 201
    return response.json()


@pytest.fixture
def resume():
    return b"Jane Doe\njane.doe@example.com\nSkills\nPython FastAPI Docker AWS PostgreSQL\nExperience\nBuilt reliable Python REST APIs and deployed Docker services on AWS. Added regression tests and improved database performance by 30 percent.\nEducation\nBachelor of Computer Science"
