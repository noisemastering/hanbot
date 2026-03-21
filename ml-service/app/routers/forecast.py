from fastapi import APIRouter, Query
from app.services import demand_forecast

router = APIRouter(prefix="/forecast", tags=["forecast"])


@router.get("/product")
def forecast_product(weeks_ahead: int = Query(4, ge=1, le=52)):
    """Predict demand per product for the next N weeks."""
    return {
        "predictions": demand_forecast.predict_product(weeks_ahead),
        "status": demand_forecast.get_status(),
    }


@router.get("/region")
def forecast_region(weeks_ahead: int = Query(4, ge=1, le=52)):
    """Predict demand per region for the next N weeks."""
    return {
        "predictions": demand_forecast.predict_region(weeks_ahead),
        "status": demand_forecast.get_status(),
    }


@router.get("/size")
def forecast_size(weeks_ahead: int = Query(4, ge=1, le=52)):
    """Predict demand per size for the next N weeks."""
    return {
        "predictions": demand_forecast.predict_size(weeks_ahead),
        "status": demand_forecast.get_status(),
    }
