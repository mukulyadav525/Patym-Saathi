"""price each week's sales sold at

Revision ID: 3b9d0c5e7a21
Revises: ebf4ec538635
Create Date: 2026-10-31 15:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '3b9d0c5e7a21'
down_revision: Union[str, Sequence[str], None] = 'ebf4ec538635'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('sales_weekly', sa.Column('unit_price', sa.Numeric(precision=12, scale=2), nullable=True))
    # Existing records sold at the price on file today (the best record there is).
    op.execute("UPDATE sales_weekly SET unit_price = products.sell_price FROM products "
               "WHERE products.id = sales_weekly.product_id AND sales_weekly.unit_price IS NULL")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('sales_weekly', 'unit_price')
