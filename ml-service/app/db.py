from motor.motor_asyncio import AsyncIOMotorClient
from app.config import MONGODB_URI

client = AsyncIOMotorClient(MONGODB_URI)
db = client.get_default_database()

# Collections used for ML
click_logs = db["clicklogs"]
conversations = db["conversations"]
users = db["users"]
products = db["products"]
product_families = db["productfamilies"]
