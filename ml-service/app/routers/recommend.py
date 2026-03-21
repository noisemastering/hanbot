from fastapi import APIRouter, Query
from app.services import cross_sell

router = APIRouter(prefix="/recommend", tags=["recommend"])


@router.get("/cross-sell")
def get_cross_sell(
    product: str = Query(..., description="Product name to get recommendations for"),
    city: str = Query(None),
    state: str = Query(None),
    amount: float = Query(0),
    top_n: int = Query(5, ge=1, le=20),
):
    """Get cross-sell recommendations for a product."""
    return {
        "recommendations": cross_sell.recommend(product, city, state, amount, top_n),
        "status": cross_sell.get_status(),
    }
