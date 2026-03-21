import os
from dotenv import load_dotenv

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017/hanlob")
PORT = int(os.getenv("PORT", 8000))
RETRAIN_CRON_HOUR = int(os.getenv("RETRAIN_CRON_HOUR", 3))
