from fastapi import APIRouter
from app.services.trainer import retrain_all, get_status

router = APIRouter(prefix="/training", tags=["training"])


@router.post("/retrain")
async def retrain():
    """Manually trigger a full retrain of all models."""
    result = await retrain_all()
    return result


@router.get("/status")
def training_status():
    """Get current training status and last run info."""
    return get_status()
