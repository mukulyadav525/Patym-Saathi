"""Buying from vendors: compare every brand and quality the suppliers offer for an item, buy one (it waits for
the merchant's approval like any purchase plan), and profit per item from what the stock actually cost."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import schemas as s
from app.db import get_db
from app.security import Ctx, current_ctx
from app.services import profit, sourcing, views

buying_api = APIRouter(prefix="/api/v1")


@buying_api.get("/products/{product_id}/sourcing", response_model=s.SourcingOut)
def compare_vendors(product_id: uuid.UUID, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.SourcingOut:
    out = s.SourcingOut(**sourcing.compare(db, ctx.merchant_id, product_id))
    db.commit()  # simulated price lists may have been re-issued
    return out


@buying_api.post("/purchases", response_model=s.TaskDetail)
def buy(body: s.PurchaseIn, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.TaskDetail:
    """Drafts the purchase and asks for approval. Nothing is ordered until the merchant approves it."""
    task = sourcing.start_purchase(db, ctx, body.quote_id, body.packs, body.sell_price)
    return views.task_detail(db, ctx.merchant_id, task.id)


@buying_api.get("/profit", response_model=s.ProfitReport)
def profit_report(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.ProfitReport:
    return s.ProfitReport(**profit.report(db, ctx.merchant_id))
