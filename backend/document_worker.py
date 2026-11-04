"""One-shot document worker. Reads/writes JSON over pipes; never accesses the database."""

import base64
import json
import sys

MAX_TEXT = 200_000


def main():
    # Linux resource limits apply before importing document libraries.
    import resource

    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024**2, 512 * 1024**2))
    resource.setrlimit(resource.RLIMIT_CPU, (6, 6))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    try:
        from .parser import ResumeTooLargeError, parse_resume

        payload = json.loads(sys.stdin.buffer.read(8 * 1024**2))
        profile = parse_resume(
            payload["filename"], base64.b64decode(payload["data"], validate=True)
        )
        if len(profile["raw_text"]) > MAX_TEXT:
            print(
                json.dumps(
                    {
                        "error": "Extracted text exceeds 200,000 characters. Upload a shorter resume.",
                        "status": 413,
                    }
                )
            )
        elif not profile["raw_text"].strip():
            print(
                json.dumps(
                    {
                        "error": "No readable text found. Scanned PDFs need OCR before uploading.",
                        "status": 422,
                    }
                )
            )
        else:
            print(json.dumps({"profile": profile}))
    except ResumeTooLargeError as exc:
        print(json.dumps({"error": str(exc), "status": 413}))
    except Exception:
        print(
            json.dumps(
                {
                    "error": "Could not read this document. Upload a valid, text-based PDF, DOCX, or TXT file.",
                    "status": 422,
                }
            )
        )


if __name__ == "__main__":
    main()
