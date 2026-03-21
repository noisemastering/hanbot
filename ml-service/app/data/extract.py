"""
Data extraction from MongoDB for ML models.
Pulls orders, click logs, conversations, and product catalog into DataFrames.
"""
import pandas as pd
from app.db import click_logs, conversations, users, products, product_families


async def get_conversions() -> pd.DataFrame:
    """Completed conversions with product, location, amount, and timing."""
    cursor = click_logs.find(
        {"converted": True},
        {
            "productName": 1, "mlItemId": 1, "city": 1, "stateMx": 1,
            "createdAt": 1, "clickedAt": 1, "convertedAt": 1,
            "conversionData.totalAmount": 1,
            "conversionData.shippingCity": 1,
            "conversionData.shippingState": 1,
            "correlationConfidence": 1,
            "correlationMethod": 1,
        }
    )
    docs = await cursor.to_list(length=None)
    if not docs:
        return pd.DataFrame()

    rows = []
    for d in docs:
        cd = d.get("conversionData", {})
        rows.append({
            "product_name": d.get("productName"),
            "ml_item_id": d.get("mlItemId"),
            "city": cd.get("shippingCity") or d.get("city"),
            "state": cd.get("shippingState") or d.get("stateMx"),
            "amount": cd.get("totalAmount", 0),
            "click_date": d.get("clickedAt") or d.get("createdAt"),
            "conversion_date": d.get("convertedAt"),
            "confidence": d.get("correlationConfidence"),
        })
    return pd.DataFrame(rows)


async def get_conversations_demand() -> pd.DataFrame:
    """Conversation-level demand signals: what people asked about (bought or not)."""
    cursor = conversations.find(
        {"productSpecs": {"$exists": True}},
        {
            "currentFlow": 1, "productInterest": 1,
            "productSpecs": 1, "city": 1, "stateMx": 1, "zipCode": 1,
            "purchaseIntent": 1, "handoffRequested": 1,
            "createdAt": 1,
        }
    )
    docs = await cursor.to_list(length=None)
    if not docs:
        return pd.DataFrame()

    rows = []
    for d in docs:
        specs = d.get("productSpecs", {})
        rows.append({
            "flow": d.get("currentFlow"),
            "product_interest": d.get("productInterest"),
            "product_type": specs.get("productType"),
            "width": specs.get("width"),
            "length": specs.get("length"),
            "size": specs.get("size"),
            "percentage": specs.get("percentage"),
            "color": specs.get("color"),
            "quantity": specs.get("quantity"),
            "city": d.get("city"),
            "state": d.get("stateMx"),
            "zip_code": d.get("zipCode"),
            "purchase_intent": d.get("purchaseIntent"),
            "handoff": d.get("handoffRequested", False),
            "date": d.get("createdAt"),
        })
    return pd.DataFrame(rows)


async def get_product_catalog() -> pd.DataFrame:
    """Product catalog with pricing and dimensions."""
    cursor = products.find(
        {},
        {
            "name": 1, "type": 1, "familyId": 1, "size": 1,
            "price": 1, "wholesalePrice": 1, "wholesaleMinQty": 1,
        }
    )
    docs = await cursor.to_list(length=None)
    if not docs:
        return pd.DataFrame()

    rows = []
    for d in docs:
        rows.append({
            "product_id": str(d["_id"]),
            "name": d.get("name"),
            "type": d.get("type"),
            "family_id": str(d["familyId"]) if d.get("familyId") else None,
            "size": d.get("size"),
            "price": d.get("price"),
            "wholesale_price": d.get("wholesalePrice"),
            "wholesale_min_qty": d.get("wholesaleMinQty"),
        })
    return pd.DataFrame(rows)


async def get_user_locations() -> pd.DataFrame:
    """User locations and product interest for regional analysis."""
    cursor = users.find(
        {"location": {"$exists": True}},
        {
            "location.city": 1, "location.state": 1, "location.zipcode": 1,
            "poi.rootName": 1, "poi.familyName": 1,
        }
    )
    docs = await cursor.to_list(length=None)
    if not docs:
        return pd.DataFrame()

    rows = []
    for d in docs:
        loc = d.get("location", {})
        poi = d.get("poi", {})
        rows.append({
            "city": loc.get("city"),
            "state": loc.get("state"),
            "zip_code": loc.get("zipcode"),
            "poi_root": poi.get("rootName"),
            "poi_family": poi.get("familyName"),
        })
    return pd.DataFrame(rows)
