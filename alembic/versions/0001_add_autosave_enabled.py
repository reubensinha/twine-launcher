"""add autosave_enabled to users

Revision ID: 0001
Revises:
Create Date: 2026-05-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: fresh DBs already have this column from create_all();
    # old deployments without it get it added here.
    bind = op.get_bind()
    cols = [c['name'] for c in sa_inspect(bind).get_columns('users')]
    if 'autosave_enabled' not in cols:
        op.add_column('users', sa.Column(
            'autosave_enabled', sa.Boolean(), nullable=False, server_default='1'
        ))


def downgrade() -> None:
    # SQLite does not support DROP COLUMN reliably on older versions; skip.
    pass
