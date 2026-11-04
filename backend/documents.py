"""Bounded uploads and resource-limited, disposable document extraction."""

import base64
import hashlib
import io
import json
import os
import subprocess
import sys
import threading
import zipfile
from pathlib import Path

from fastapi import HTTPException, UploadFile

MAX_FILE = 5 * 1024**2
WORKER_TIMEOUT = 12
WORKERS = threading.BoundedSemaphore(2)


def read_resume(file: UploadFile) -> tuple[dict, str]:
    filename = Path((file.filename or "resume").replace("\\", "/")).name
    if len(filename) > 255 or not filename.lower().endswith((".pdf", ".docx", ".txt")):
        raise HTTPException(
            400, "Use a PDF, DOCX, or TXT file with a filename under 256 characters."
        )
    data = file.file.read(MAX_FILE + 1)
    if not data:
        raise HTTPException(400, "The resume file is empty.")
    if len(data) > MAX_FILE:
        raise HTTPException(413, "File exceeds the 5 MB limit.")
    if filename.lower().endswith(".docx"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                entries = archive.infolist()
                if len(entries) > 1000 or sum(item.file_size for item in entries) > 20 * 1024**2:
                    raise HTTPException(
                        413, "Expanded document exceeds the 20 MB or 1,000-entry limit."
                    )
        except zipfile.BadZipFile as exc:
            raise HTTPException(422, "Could not read this DOCX document.") from exc
    if not WORKERS.acquire(blocking=False):
        raise HTTPException(
            503, "Document workers are busy. Retry in a few seconds.", headers={"Retry-After": "5"}
        )
    try:
        # No workspace credentials, database URL, or proxy secrets are passed into workers.
        result = subprocess.run(
            [sys.executable, "-m", "backend.document_worker"],
            input=json.dumps(
                {"filename": filename, "data": base64.b64encode(data).decode()}
            ).encode(),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=WORKER_TIMEOUT,
            cwd=Path(__file__).resolve().parent.parent,
            env={"PATH": os.defpath, "LANG": "C.UTF-8", "PYTHONDONTWRITEBYTECODE": "1"},
            start_new_session=True,
        )
        if result.returncode:
            raise HTTPException(
                422,
                "Document exceeded extraction resource limits or could not be read. Try a simpler document.",
            )
        payload = json.loads(result.stdout)
        if "error" in payload:
            raise HTTPException(payload["status"], payload["error"])
        return payload["profile"], hashlib.sha256(data).hexdigest()
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(
            422, "Document extraction timed out. Try a shorter or simpler document."
        ) from exc
    except (ValueError, KeyError) as exc:
        raise HTTPException(422, "Could not extract a valid resume profile.") from exc
    finally:
        WORKERS.release()
