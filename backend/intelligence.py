"""Local, deterministic retrieval model. Scores are evidence, not hiring predictions."""

from __future__ import annotations

import re

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from .matcher import _extract_skills

MODEL_VERSION = "tfidf-word-char-v1"
WEIGHTS = {"skills": 0.65, "relevance": 0.35}


def anonymize(text: str) -> str:
    # Exclude contact details and education/name headers from the text signal.
    text = re.sub(r"https?://\S+|www\.\S+|\S+@\S+|(?:linkedin|github)\.com/\S+", " ", text)
    text = re.sub(r"\+?\d[\d ()-]{8,}\d", " ", text)
    return text


def rank(profile: dict, description: str, required_skills: list[str] | None = None) -> dict:
    raw = profile.get("raw_text", "")
    # Contact/name fields are never explicit ranking features.
    body = raw.replace(profile.get("name", ""), " ") if profile.get("name") else raw
    texts = [anonymize(body), anonymize(description)]
    relevance = 0.0
    terms: list[dict] = []
    try:
        vectorizer = TfidfVectorizer(
            stop_words="english", ngram_range=(1, 2), sublinear_tf=True, max_features=6000
        )
        matrix = vectorizer.fit_transform(texts)
        word_score = float(cosine_similarity(matrix[0], matrix[1])[0, 0])
        char_matrix = TfidfVectorizer(
            analyzer="char_wb", ngram_range=(3, 5), max_features=10000
        ).fit_transform(texts)
        char_score = float(cosine_similarity(char_matrix[0], char_matrix[1])[0, 0])
        relevance = 0.8 * word_score + 0.2 * char_score
        contributions = matrix[0].multiply(matrix[1]).toarray().ravel()
        names = vectorizer.get_feature_names_out()
        indices = contributions.argsort()[::-1]
        terms = [
            {"term": str(names[i]), "weight": round(float(contributions[i]), 4)}
            for i in indices[:8]
            if contributions[i] > 0
        ]
    except ValueError:  # Empty vocabulary is legitimate for short/no-text documents.
        pass
    target = sorted(set(required_skills or _extract_skills(description)))
    found = set(profile.get("skills", []))
    matched = sorted(found.intersection(target))
    missing = sorted(set(target) - found)
    skill_score = len(matched) / len(target) if target else 0
    score = round(100 * (WEIGHTS["skills"] * skill_score + WEIGHTS["relevance"] * relevance), 1)
    lines = raw.splitlines()
    evidence = []
    for skill in matched:
        from .skills import SKILL_ALIASES

        aliases = SKILL_ALIASES.get(skill, [skill.lower()])
        line = next(
            (
                line.strip()
                for line in lines
                if any(
                    re.search(r"(?<!\w)" + re.escape(alias) + r"(?!\w)", line, re.I)
                    for alias in aliases
                )
            ),
            "",
        )
        evidence.append({"skill": skill, "excerpt": line[:220]})
    return {
        "score": score,
        "skill_match_pct": round(skill_score * 100, 1),
        "text_similarity_pct": round(relevance * 100, 1),
        "matched_skills": matched,
        "missing_skills": missing,
        "extra_skills": sorted(found - set(target)),
        "jd_skills": target,
        "verdict": "Strong alignment"
        if score >= 75
        else "Promising alignment"
        if score >= 55
        else "Partial alignment"
        if score >= 35
        else "Limited evidence",
        "evidence": evidence,
        "shared_terms": terms,
        "model_version": MODEL_VERSION,
        "weights": WEIGHTS,
        "warnings": (
            ["No recognized role skills; add explicit requirements."] if not target else []
        )
        + (
            ["Limited extracted text; review the original resume."]
            if profile.get("word_count", 0) < 30
            else []
        ),
    }


def interview_guide(candidate: dict, report: dict) -> list[dict]:
    questions = []
    for item in report["evidence"][:3]:
        questions.append(
            {
                "kind": "Validate evidence",
                "skill": item["skill"],
                "question": f"Walk through a project where you used {item['skill']}. What tradeoffs did you make, and how did you measure the outcome?",
                "context": item["excerpt"],
                "look_for": "Specific ownership, alternatives considered, measured impact, and lessons learned.",
            }
        )
    for skill in report["missing_skills"][:3]:
        questions.append(
            {
                "kind": "Explore a gap",
                "skill": skill,
                "question": f"This role uses {skill}, which is not explicit in your resume. What related experience could help you learn it?",
                "context": "Missing evidence is not proof of missing ability.",
                "look_for": "Transferable concepts, honest limits, and a concrete learning approach.",
            }
        )
    return questions or [
        {
            "kind": "Project deep dive",
            "skill": "Engineering judgment",
            "question": "Describe a difficult technical decision. What alternatives did you consider?",
            "context": "Review the resume directly; there is not enough skill evidence for tailored questions.",
            "look_for": "Clear reasoning, evidence, ownership, and reflection.",
        }
    ]
