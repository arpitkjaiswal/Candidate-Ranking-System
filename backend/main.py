"""TalentOS: a local-first, single-workspace candidate intelligence API."""

from __future__ import annotations

import csv
import hmac
import io
import logging
import os
import time
from collections import OrderedDict, deque
from contextlib import asynccontextmanager
from datetime import UTC
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select, text
from sqlalchemy import update as sql_update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from .database import Activity, Candidate, Job, connect
from .demo import seed
from .documents import read_resume
from .http_limits import RequestBodyLimit
from .intelligence import MODEL_VERSION, interview_guide, rank
from .matcher import _extract_skills
from .skills import ALL_SKILLS

LOG = logging.getLogger("talentos")
ROOT = Path(__file__).resolve().parent.parent
STAGES = ("New", "Shortlisted", "Interview", "Offer", "Rejected")


class JobInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=3, max_length=120)
    department: str = Field(default="Engineering", min_length=2, max_length=80)
    location: str = Field(default="Remote", min_length=2, max_length=100)
    description: str = Field(min_length=30, max_length=20000)
    required_skills: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("title", "department", "location", "description", mode="before")
    @classmethod
    def trim(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("required_skills")
    @classmethod
    def skills(cls, values):
        canonical = {skill.lower(): skill for skill in ALL_SKILLS}
        if any(value.lower() not in canonical for value in values):
            raise ValueError("Select skills from the supported catalog.")
        return sorted({canonical[value.lower()] for value in values})


class RoleUpdate(JobInput):
    version: int = Field(ge=1)


class CandidateUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=1)
    stage: Literal["New", "Shortlisted", "Interview", "Offer", "Rejected"] | None = None
    notes: str | None = Field(default=None, max_length=5000)


def get_session(request: Request):
    with request.app.state.sessions() as session:
        yield session


def job_or_404(session: Session, job_id: str):
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(404, "Role not found.")
    return job


def candidate_or_404(session: Session, candidate_id: str):
    candidate = session.get(Candidate, candidate_id)
    if candidate is None:
        raise HTTPException(404, "Candidate not found.")
    return candidate


def log_activity(session: Session, job_id: str, action: str, detail: str):
    session.add(Activity(id=str(uuid4()), job_id=job_id, action=action, detail=detail))


def profile_public(profile: dict):
    return {key: value for key, value in profile.items() if key != "raw_text"}


def candidate_data(candidate: Candidate):
    return {
        "id": candidate.id,
        "job_id": candidate.job_id,
        "filename": candidate.filename,
        "version": candidate.version,
        "profile": profile_public(candidate.profile),
        "report": candidate.report,
        "stage": candidate.stage,
        "notes": candidate.notes,
        "synthetic": candidate.synthetic,
        "created_at": candidate.created_at.replace(tzinfo=UTC).isoformat(),
    }


def job_data(job: Job, count: int = 0):
    return {
        "id": job.id,
        "title": job.title,
        "version": job.version,
        "department": job.department,
        "location": job.location,
        "description": job.description,
        "required_skills": job.required_skills,
        "candidate_count": count,
        "created_at": job.created_at.replace(tzinfo=UTC).isoformat(),
    }


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        engine, sessions = connect()
        app.state.engine = engine
        app.state.sessions = sessions
        if os.getenv("TALENT_DEMO", "1") == "1":
            with sessions() as session:
                seed(session)
        try:
            yield
        finally:
            engine.dispose()

    app = FastAPI(
        title="TalentOS API",
        version="2.1.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    api_key = os.getenv("TALENT_API_KEY", "")
    if os.getenv("TALENT_ENV", "development") == "production" and len(api_key) < 32:
        raise RuntimeError("Production requires a TALENT_API_KEY of at least 32 characters.")
    app.add_middleware(RequestBodyLimit)
    rate_limit = int(os.getenv("TALENT_RATE_LIMIT", "120"))
    if not 1 <= rate_limit <= 10000:
        raise RuntimeError("TALENT_RATE_LIMIT must be between 1 and 10,000 requests per minute.")
    buckets: OrderedDict[str, deque] = OrderedDict()

    @app.exception_handler(StaleDataError)
    async def stale_update(request, exc):
        return JSONResponse(
            {"detail": "This record changed in another session. Refresh it before saving."},
            status_code=409,
        )

    @app.middleware("http")
    async def boundary(request: Request, call_next):
        started = time.monotonic()
        request_id = str(uuid4())
        public = request.url.path in ("/api/health", "/api/meta")

        async def dispatch():
            if request.url.path.startswith("/api/") and not public:
                identity = request.client.host if request.client else "local"
                bucket = buckets.setdefault(identity, deque())
                buckets.move_to_end(identity)
                while len(buckets) > 4096:
                    buckets.popitem(last=False)
                cutoff = time.monotonic() - 60
                while bucket and bucket[0] < cutoff:
                    bucket.popleft()
                if len(bucket) >= rate_limit:
                    return JSONResponse(
                        {"detail": "Too many requests. Retry in one minute."},
                        status_code=429,
                        headers={"Retry-After": "60"},
                    )
                bucket.append(time.monotonic())
                token = request.headers.get("authorization", "").removeprefix("Bearer ")
                if api_key and not hmac.compare_digest(token.encode(), api_key.encode()):
                    return JSONResponse(
                        {"detail": "A valid workspace access key is required."}, status_code=401
                    )
            return await call_next(request)

        try:
            response = await dispatch()
        except OperationalError:
            LOG.error("database unavailable request_id=%s", request_id)
            response = JSONResponse(
                {"detail": "The database is temporarily unavailable. Please retry."},
                status_code=503,
                headers={"Retry-After": "5"},
            )
        except Exception as exc:
            LOG.error(
                "request failed request_id=%s exception_type=%s", request_id, type(exc).__name__
            )
            response = JSONResponse(
                {
                    "detail": "An unexpected error occurred. Retry or share the request ID with your administrator."
                },
                status_code=500,
            )
        response.headers.update(
            {
                "X-Request-ID": request_id,
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
                "X-Frame-Options": "DENY",
                "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
            }
        )
        if not request.url.path.startswith("/api/"):
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
            )
        else:
            response.headers["Cache-Control"] = "no-store"
        # No resume contents, names, tokens, or query strings in application logs.
        LOG.info(
            "request id=%s method=%s status=%s duration_ms=%.1f",
            request_id,
            request.method,
            response.status_code,
            1000 * (time.monotonic() - started),
        )
        return response

    @app.get("/api/health")
    def health(session: Session = Depends(get_session)):
        session.execute(text("SELECT 1"))
        return {"status": "ok"}

    @app.get("/api/meta")
    def meta():
        return {
            "version": "2.1.0",
            "auth_required": bool(api_key),
            "model_version": MODEL_VERSION,
            "deployment": "single-workspace",
            "demo_enabled": os.getenv("TALENT_DEMO", "1") == "1",
        }

    @app.get("/api/skills")
    def skills():
        return ALL_SKILLS

    @app.get("/api/jobs")
    def jobs(session: Session = Depends(get_session)):
        counts = dict(
            session.execute(select(Candidate.job_id, func.count()).group_by(Candidate.job_id)).all()
        )
        return [
            job_data(job, counts.get(job.id, 0))
            for job in session.scalars(select(Job).order_by(Job.created_at))
        ]

    @app.post("/api/jobs", status_code=201)
    def new_job(body: JobInput, session: Session = Depends(get_session)):
        if session.scalar(select(func.count()).select_from(Job)) >= 100:
            raise HTTPException(409, "Workspace limit reached: 100 roles.")
        values = body.model_dump()
        if not values["required_skills"]:
            values["required_skills"] = _extract_skills(body.description)
        job = Job(id=str(uuid4()), **values)
        session.add(job)
        session.flush()
        log_activity(session, job.id, "Role created", "Ready to review candidate evidence.")
        session.commit()
        return job_data(job)

    @app.put("/api/jobs/{job_id}")
    def edit_job(job_id: str, body: RoleUpdate, session: Session = Depends(get_session)):
        job = job_or_404(session, job_id)
        if job.version != body.version:
            raise HTTPException(
                409, "This role changed in another session. Refresh before editing."
            )
        values = body.model_dump(exclude={"version"})
        values["required_skills"] = values["required_skills"] or _extract_skills(body.description)
        for key, value in values.items():
            setattr(job, key, value)
        for candidate in job.candidates:
            candidate.report = rank(candidate.profile, job.description, job.required_skills)
        log_activity(
            session,
            job_id,
            "Role updated",
            "Requirements saved and all candidate alignment reports recalculated.",
        )
        session.commit()
        return job_data(job, len(job.candidates))

    @app.delete("/api/jobs/{job_id}", status_code=204)
    def remove_role(
        job_id: str, version: int = Query(..., ge=1), session: Session = Depends(get_session)
    ):
        job = job_or_404(session, job_id)
        if job.version != version:
            raise HTTPException(409, "This role changed. Refresh before deleting.")
        session.delete(job)
        session.commit()
        return Response(status_code=204)

    @app.get("/api/candidates/{candidate_id}")
    def candidate_detail(candidate_id: str, session: Session = Depends(get_session)):
        return candidate_data(candidate_or_404(session, candidate_id))

    @app.get("/api/jobs/{job_id}/candidates")
    def candidates(
        job_id: str,
        session: Session = Depends(get_session),
        offset: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=500),
    ):
        job_or_404(session, job_id)
        rows = list(session.scalars(select(Candidate).where(Candidate.job_id == job_id)))
        rows.sort(key=lambda candidate: (-candidate.report["score"], candidate.id))
        return {
            "items": [candidate_data(candidate) for candidate in rows[offset : offset + limit]],
            "total": len(rows),
        }

    @app.post("/api/jobs/{job_id}/candidates", status_code=201)
    def upload(
        job_id: str, files: list[UploadFile] = File(...), session: Session = Depends(get_session)
    ):
        job = job_or_404(session, job_id)
        if len(files) > 10:
            raise HTTPException(400, "Upload at most 10 resumes at a time.")
        # Parse outside a write transaction, then compare-and-swap the role aggregate.
        # This prevents an upload from storing scores for requirements that changed mid-request.
        snapshot = {
            "version": job.version,
            "description": job.description,
            "skills": list(job.required_skills),
        }
        session.rollback()
        prepared, errors = [], []
        for file in files:
            try:
                profile, digest = read_resume(file)
                prepared.append(
                    (
                        file,
                        profile,
                        digest,
                        rank(profile, snapshot["description"], snapshot["skills"]),
                    )
                )
            except HTTPException as exc:
                errors.append({"filename": file.filename, "detail": exc.detail})
        added = []
        if prepared:
            result = session.execute(
                sql_update(Job)
                .where(Job.id == job_id, Job.version == snapshot["version"])
                .values(version=Job.version + 1),
                execution_options={"synchronize_session": False},
            )
            if result.rowcount != 1:
                session.rollback()
                raise HTTPException(
                    409,
                    "Role requirements changed during analysis. Refresh the role and retry; no candidates from this batch were added.",
                )
            count = session.scalar(
                select(func.count()).select_from(Candidate).where(Candidate.job_id == job_id)
            )
            if count + len(prepared) > 500:
                raise HTTPException(409, "Role limit reached: 500 candidates.")
            for file, profile, digest, report in prepared:
                try:
                    with session.begin_nested():
                        candidate = Candidate(
                            id=str(uuid4()),
                            job_id=job_id,
                            content_hash=digest,
                            filename=Path((file.filename or "resume").replace("\\", "/")).name,
                            profile=profile,
                            report=report,
                        )
                        session.add(candidate)
                        session.flush()
                        added.append(candidate_data(candidate))
                except IntegrityError:
                    errors.append(
                        {
                            "filename": file.filename,
                            "detail": "This exact resume is already in this role.",
                        }
                    )
        if added:
            log_activity(
                session,
                job_id,
                "Resumes analyzed",
                f"{len(added)} candidate(s) added with explainable scores.",
            )
        session.commit()
        return {"added": added, "errors": errors}

    @app.patch("/api/candidates/{candidate_id}")
    def update(candidate_id: str, body: CandidateUpdate, session: Session = Depends(get_session)):
        candidate = candidate_or_404(session, candidate_id)
        if body.version != candidate.version:
            raise HTTPException(
                409,
                "This candidate changed in another session. Refresh before saving; your draft has been kept.",
            )
        if body.stage is not None and body.stage != candidate.stage:
            log_activity(
                session,
                candidate.job_id,
                "Pipeline updated",
                f"Candidate moved from {candidate.stage} to {body.stage}.",
            )
            candidate.stage = body.stage
        if body.notes is not None:
            candidate.notes = body.notes
        session.commit()
        return candidate_data(candidate)

    @app.delete("/api/candidates/{candidate_id}", status_code=204)
    def delete(
        candidate_id: str, version: int = Query(..., ge=1), session: Session = Depends(get_session)
    ):
        candidate = candidate_or_404(session, candidate_id)
        if candidate.version != version:
            raise HTTPException(409, "This candidate changed. Refresh before deleting.")
        job_id = candidate.job_id
        session.delete(candidate)
        log_activity(
            session,
            job_id,
            "Candidate removed",
            "Profile, extracted text, scores, and notes deleted from the application database.",
        )
        session.commit()
        return Response(status_code=204)

    @app.get("/api/candidates/{candidate_id}/interview")
    def interview(candidate_id: str, session: Session = Depends(get_session)):
        candidate = candidate_or_404(session, candidate_id)
        return {
            "source": "Evidence-based templates; no language model is used.",
            "questions": interview_guide(candidate.profile, candidate.report),
        }

    @app.get("/api/jobs/{job_id}/activity")
    def activity(job_id: str, session: Session = Depends(get_session)):
        job_or_404(session, job_id)
        return [
            {
                "id": item.id,
                "action": item.action,
                "detail": item.detail,
                "created_at": item.created_at.replace(tzinfo=UTC).isoformat(),
            }
            for item in session.scalars(
                select(Activity)
                .where(Activity.job_id == job_id)
                .order_by(Activity.created_at.desc())
                .limit(20)
            )
        ]

    @app.get("/api/jobs/{job_id}/export")
    def export(job_id: str, session: Session = Depends(get_session)):
        job_or_404(session, job_id)
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Name", "Email", "Stage", "Alignment", "Matched skills", "Missing skills"])

        def safe(value):
            value = str(value or "")
            return (
                "'" + value
                if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r", "\n"))
                else value
            )

        rows = list(session.scalars(select(Candidate).where(Candidate.job_id == job_id)))
        for candidate in sorted(rows, key=lambda candidate: -candidate.report["score"]):
            writer.writerow(
                [
                    safe(candidate.profile.get("name")),
                    safe(candidate.profile.get("email")),
                    candidate.stage,
                    candidate.report["score"],
                    ", ".join(candidate.report["matched_skills"]),
                    ", ".join(candidate.report["missing_skills"]),
                ]
            )
        return Response(
            output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="talentos-candidates.csv"'},
        )

    @app.post("/api/parse")
    def parse(file: UploadFile = File(...)):
        profile, _ = read_resume(file)
        return profile_public(profile)

    @app.post("/api/match")
    def match(
        file: UploadFile = File(...),
        job_description: str = Form(..., min_length=1, max_length=20000),
    ):
        if not job_description.strip():
            raise HTTPException(400, "A job description is required.")
        profile, _ = read_resume(file)
        report = rank(profile, job_description)
        return {
            "resume": profile_public(profile),
            "match": report,
            "interview": interview_guide(profile, report),
        }

    dist = ROOT / "frontend" / "dist"
    if dist.exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/")
    def index():
        if not (dist / "index.html").exists():
            return JSONResponse(
                {"detail": "Build the frontend: cd frontend && npm ci && npm run build"},
                status_code=503,
            )
        return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "backend.main:app", host="127.0.0.1", port=int(os.getenv("PORT", "8000")), reload=True
    )
