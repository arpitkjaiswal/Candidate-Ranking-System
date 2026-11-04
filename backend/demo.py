"""Explicitly synthetic seed data for the portfolio demo."""

import hashlib
from uuid import uuid4

from sqlalchemy import select

from .database import Activity, Candidate, Job
from .intelligence import rank
from .parser import parse_resume

ROLE = """Build reliable backend services and developer platforms. Design REST APIs in Python and FastAPI, optimize PostgreSQL queries, and operate services with Docker on AWS. Collaborate on system design, implement unit testing, and improve CI/CD pipelines. Communicate technical tradeoffs clearly and own measurable improvements to reliability."""
PEOPLE = [
    (
        "Alex Morgan",
        "Python FastAPI PostgreSQL Docker AWS REST APIs system design unit testing CI/CD Git",
        "Built a Python platform serving 2 million requests daily. Reduced API p95 latency by 38% through PostgreSQL indexing and caching. Led incident reviews and rolled out Docker services on AWS.",
        "Interview",
    ),
    (
        "Jordan Lee",
        "Python FastAPI SQL PostgreSQL Docker AWS Git REST APIs unit testing",
        "Designed REST APIs for a payments platform. Implemented idempotency and integration tests. Reduced deployment time from 20 minutes to 4 with CI/CD.",
        "Shortlisted",
    ),
    (
        "Sam Rivera",
        "Python Django PostgreSQL Docker REST APIs Git Linux",
        "Shipped a Django analytics service used by 200 teams. Tuned PostgreSQL queries and automated regression testing. Mentored two engineers.",
        "New",
    ),
    (
        "Taylor Chen",
        "Python FastAPI Docker AWS REST APIs CI/CD unit testing",
        "Developed event processing services with Python and FastAPI. Owned Docker deployment automation and AWS monitoring. Cut failed releases by 25%.",
        "Shortlisted",
    ),
    (
        "Casey Patel",
        "JavaScript TypeScript React HTML CSS Git REST APIs",
        "Built an accessible React application with TypeScript. Improved page performance by 40% and integrated REST APIs for a design platform.",
        "New",
    ),
    (
        "Riley Brooks",
        "Python SQL Pandas NumPy Machine Learning scikit-learn Git",
        "Created reproducible machine learning pipelines for demand forecasting. Validated models with time-series cross validation and documented limitations.",
        "New",
    ),
]


def seed(session):
    if session.scalar(select(Job.id).limit(1)):
        return False
    job = Job(
        id=str(uuid4()),
        title="Senior Backend Engineer",
        department="Engineering",
        location="Remote · India",
        description=ROLE,
        required_skills=[
            "Python",
            "FastAPI",
            "PostgreSQL",
            "Docker",
            "AWS",
            "REST API",
            "Testing",
            "CI/CD",
        ],
    )
    session.add(job)
    session.flush()
    for index, (name, skills, experience, stage) in enumerate(PEOPLE):
        text = f"{name}\n{name.lower().replace(' ', '.')}@example.com\nSkills\n{skills}\nExperience\n{experience}\nEducation\nBachelor of Computer Science\nProjects\nOpen source developer tooling and technical documentation."
        profile = parse_resume("demo.txt", text.encode())
        session.add(
            Candidate(
                id=str(uuid4()),
                job_id=job.id,
                content_hash=hashlib.sha256(text.encode()).hexdigest(),
                filename=f"demo-{index + 1}.txt",
                profile=profile,
                report=rank(profile, job.description, job.required_skills),
                stage=stage,
                synthetic=True,
            )
        )
    session.add(
        Job(
            id=str(uuid4()),
            title="Frontend Engineer",
            department="Product",
            location="Bengaluru · Hybrid",
            description="Build accessible interfaces with React, TypeScript, HTML and CSS. Write unit testing and integrate REST APIs with Git workflows.",
            required_skills=["React", "TypeScript", "HTML", "CSS", "Testing"],
        )
    )
    session.add(
        Job(
            id=str(uuid4()),
            title="Machine Learning Engineer",
            department="Data & AI",
            location="Remote · Global",
            description="Build evaluated machine learning pipelines with Python, scikit-learn, Pandas, SQL, Docker and AWS. Design reproducible experiments and monitor data quality.",
            required_skills=[
                "Python",
                "Machine Learning",
                "scikit-learn",
                "Pandas",
                "SQL",
                "Docker",
            ],
        )
    )
    session.add(
        Activity(
            id=str(uuid4()),
            job_id=job.id,
            action="Demo workspace created",
            detail="6 synthetic profiles added for exploration. No real applicant data.",
        )
    )
    session.commit()
    return True
