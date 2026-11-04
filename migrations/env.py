from alembic import context

connection = context.config.attributes.get("connection")
if connection is None:
    raise RuntimeError("Run migrations through python -m backend.manage migrate.")
context.configure(connection=connection, transaction_per_migration=False)
with context.begin_transaction():
    context.run_migrations()
