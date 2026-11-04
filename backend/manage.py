"""Database maintenance: migrate or create a consistent SQLite backup."""

import argparse
import os
import sqlite3
from pathlib import Path

from .database import make_engine
from .schema import upgrade_schema


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("migrate")
    backup = sub.add_parser("backup")
    backup.add_argument("destination", type=Path)
    args = parser.parse_args()
    if args.command == "migrate":
        engine = make_engine()
        try:
            upgrade_schema(engine)
            print("Database migrations completed.")
        finally:
            engine.dispose()
    elif args.command == "backup":
        if os.getenv("DATABASE_URL"):
            parser.error("For PostgreSQL, use pg_dump with your managed backup policy.")
        source = Path(os.getenv("TALENT_DATA_DIR", "/workspace/.talentos")) / "talentos.db"
        if not source.exists():
            parser.error("Database does not exist.")
        # Exclusive creation protects existing backups; SQLite backup includes committed WAL state.
        with args.destination.open("xb"):
            pass
        args.destination.chmod(0o600)
        with (
            sqlite3.connect(f"file:{source}?mode=ro", uri=True) as original,
            sqlite3.connect(args.destination) as target,
        ):
            original.backup(target)
            if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("Backup integrity check failed.")
        print("Backup created and integrity checked. Treat it as sensitive applicant data.")


if __name__ == "__main__":
    main()
