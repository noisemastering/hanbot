from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import RETRAIN_CRON_HOUR
from app.routers import forecast, recommend, training
from app.services.trainer import retrain_all


scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: schedule daily retrain and run initial training
    scheduler.add_job(retrain_all, "cron", hour=RETRAIN_CRON_HOUR, minute=0)
    scheduler.start()
    await retrain_all()
    yield
    # Shutdown
    scheduler.shutdown()


app = FastAPI(
    title="HanlobBot ML Service",
    description="Demand forecasting and cross-sell recommendations",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(forecast.router)
app.include_router(recommend.router)
app.include_router(training.router)


@app.get("/health")
def health():
    return {"status": "ok"}
