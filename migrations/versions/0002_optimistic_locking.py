"""Add optimistic locking for role edits and candidate review."""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    for table in ("jobs", "candidates"):
        op.add_column(table, sa.Column("version", sa.Integer(), server_default="1", nullable=False))


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled. Restore a verified backup instead.")
