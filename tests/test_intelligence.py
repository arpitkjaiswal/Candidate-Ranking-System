import pytest

from backend.intelligence import rank
from backend.parser import parse_resume

DESCRIPTION = "Python FastAPI PostgreSQL Docker AWS REST APIs, unit testing and CI/CD."


def test_relevant_experience_ranks_above_unrelated():
    relevant = parse_resume(
        "resume.txt",
        b"Jane Doe\nPython FastAPI PostgreSQL Docker AWS REST APIs unit testing CI/CD\nExperience\nBuilt Python backend services on AWS with FastAPI and Docker.",
    )
    unrelated = parse_resume(
        "resume.txt",
        b"John Doe\nExperience\nIllustration, typography, editorial design, photography and exhibition curation.",
    )
    assert rank(relevant, DESCRIPTION)["score"] > rank(unrelated, DESCRIPTION)["score"] + 50


def test_contact_and_name_do_not_change_score():
    first = parse_resume(
        "a.txt", b"Jane Doe\njane@example.com\nPython FastAPI Docker backend engineering projects"
    )
    second = parse_resume(
        "b.txt",
        b"Alex Morgan\nalex@example.com\nPython FastAPI Docker backend engineering projects",
    )
    assert rank(first, DESCRIPTION)["score"] == rank(second, DESCRIPTION)["score"]


@pytest.mark.parametrize("text", ["", "the and or", "12345", "Python " * 500])
def test_bounded_deterministic_scores(text):
    profile = parse_resume("a.txt", text.encode())
    report = rank(profile, DESCRIPTION)
    assert 0 <= report["score"] <= 100
    assert report == rank(profile, DESCRIPTION)


def test_missing_skills_and_evidence():
    profile = parse_resume(
        "a.txt", b"Jane Doe\nPython FastAPI\nExperience\nBuilt REST APIs with Python."
    )
    report = rank(profile, DESCRIPTION, ["Python", "FastAPI", "Docker"])
    assert report["missing_skills"] == ["Docker"]
    assert report["skill_match_pct"] == 66.7
    assert all(item["excerpt"] for item in report["evidence"])
    assert report["shared_terms"]
