"""
Orchestrates data extraction and model training.
Called by both the cron job and the manual /retrain endpoint.
"""
from datetime import datetime
from app.data.extract import (
    get_conversions, get_conversations_demand,
    get_product_catalog, get_user_locations,
)
from app.services import demand_forecast, cross_sell

_last_run = None
_last_result = None


async def retrain_all() -> dict:
    """Pull fresh data and retrain all models."""
    global _last_run, _last_result

    # Extract data
    conversions = await get_conversions()
    conversations = await get_conversations_demand()
    catalog = await get_product_catalog()

    # Train demand forecast (linear regression)
    demand_forecast.train(conversions, conversations)

    # Train cross-sell (KNN)
    cross_sell.train(conversions, conversations, catalog)

    _last_run = datetime.utcnow()
    _last_result = {
        "trained_at": _last_run.isoformat(),
        "data": {
            "conversions": len(conversions),
            "conversations": len(conversations),
            "catalog": len(catalog),
        },
        "models": {
            "demand_forecast": demand_forecast.get_status(),
            "cross_sell": cross_sell.get_status(),
        },
    }
    return _last_result


def get_status() -> dict:
    return {
        "last_run": _last_run.isoformat() if _last_run else None,
        "last_result": _last_result,
    }
