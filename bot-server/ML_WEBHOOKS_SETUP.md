# Mercado Libre Webhooks Setup

## Overview

This application receives real-time notifications from Mercado Libre when orders are created, updated, or cancelled. This enables automatic order tracking and Meta→ML conversion attribution.

## Webhook Endpoint

**URL**: `https://hanbot-production.up.railway.app/ml/notifications`
**Method**: `POST`
**Response**: Must return `200 OK` within 1 second

## Configuration Steps

### 1. Access ML Developer Console

1. Go to: https://developers.mercadolibre.com.mx
2. Login with your Mercado Libre developer account
3. Navigate to **"My Applications"**
4. Select your app: **Client ID 8023119514823309**

### 2. Configure Notifications

1. Click on **"Notifications"** tab
2. Set **Callback URL**:
   ```
   https://hanbot-production.up.railway.app/ml/notifications
   ```

3. **Subscribe to Topics**:
   - ✅ **orders** - Order created/updated/cancelled
   - ⬜ items (optional)
   - ⬜ questions (optional)
   - ⬜ claims (optional)

4. Click **"Save"** or **"Update"**

### 3. Verify Configuration

Test that the webhook is reachable:

```bash
# Health check endpoint
curl https://hanbot-production.up.railway.app/ml/notifications/ping

# Expected response:
{
  "ok": true,
  "message": "ML Notifications webhook is ready",
  "timestamp": "2026-01-03T19:30:00.000Z"
}
```

### 4. Test with Real Order

1. Make a test purchase on your Mercado Libre store
2. Check backend logs for notification:
   ```
   🔔 ML Notification Received
   📦 Fetching order details for order 2000010349951978
   ✅ Order details fetched
   ✅ Order event saved to DB
   ```

3. Query the database:
   ```javascript
   // In mongo shell or backend
   db.mercadolibrerorderevents.find().sort({receivedAt: -1}).limit(5)
   ```

## Webhook Payload Structure

Mercado Libre sends:

```json
{
  "topic": "orders",
  "resource": "/orders/2000010349951978",
  "user_id": "482595248",
  "application_id": "8023119514823309",
  "sent": "2026-01-03T12:00:00.000Z",
  "attempts": 1
}
```

## How It Works

1. **ML sends notification** → `POST /ml/notifications`
2. **Backend responds 200 OK** immediately (< 1 second)
3. **Async processing**:
   - Extract order ID from `resource` field
   - Fetch full order details: `GET /orders/{id}`
   - Save to MongoDB collection: `MercadoLibreOrderEvent`
   - Log buyer, products, amounts, payment status
4. **Future**: Correlate order to ClickLog (PSID attribution)

## Database Schema

**Collection**: `mercadolibrerorderevents`

```javascript
{
  sellerId: "482595248",
  orderId: "2000010349951978",
  topic: "orders",
  resource: "/orders/2000010349951978",
  applicationId: "8023119514823309",
  receivedAt: ISODate("2026-01-03T12:00:00Z"),
  rawNotificationBody: { /* full webhook payload */ },
  orderDetail: { /* full order from ML API */ },
  processed: true,
  processedAt: ISODate("2026-01-03T12:00:01Z")
}
```

## Debugging

### View Recent Webhook Events

```bash
# Via API (requires auth)
curl http://localhost:3000/ml/notifications/events?limit=10 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Check Backend Logs

```bash
# Look for:
🔔 ML Notification Received
📦 Fetching order details for order...
✅ Order details fetched
✅ Order event saved to DB

# Errors:
❌ Error processing notification
```

### Common Issues

**1. Webhook not receiving notifications**
- Verify callback URL in ML console matches exactly
- Check that server is publicly accessible (not localhost)
- Ensure HTTPS is enabled (ML requires HTTPS)

**2. 401 Unauthorized when fetching order**
- Seller's OAuth token expired → refresh token automatically
- Check MercadoLibreAuth collection has valid token for seller

**3. Can't parse order ID**
- Check `resource` field format: `/orders/1234567890`
- Update regex if ML changes format

## Next Steps

Once webhooks are working:

1. **Implement Correlation Algorithm**:
   - Match ML orders to ClickLog by product_id + timestamp
   - Attribute sales to Meta PSID (Facebook Messenger users)
   - Calculate conversion rate: Meta clicks → ML sales

2. **Dashboard Integration**:
   - Show real-time order notifications
   - Display Meta→ML attribution funnel
   - Revenue tracking by PSID/campaign

3. **Alerts**:
   - Notify when high-value order received
   - Alert on failed order processing

## Support

- ML Notifications Docs: https://developers.mercadolibre.com/en_us/notifications
- API Reference: https://developers.mercadolibre.com/en_us/orders-management

## Changelog

- **2026-01-03**: Initial webhook implementation
  - POST /ml/notifications endpoint
  - GET /ml/notifications/ping health check
  - MercadoLibreOrderEvent model
  - Async order detail fetching
