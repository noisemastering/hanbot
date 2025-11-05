# HanlobBot Deployment Guide

## Railway Deployment (Bot Server)

### Prerequisites
- GitHub account with this repository pushed
- Railway account (https://railway.app)
- MongoDB Atlas cluster (already configured)
- Facebook Page Access Token
- OpenAI API Key

### Environment Variables Required

Configure these in Railway's environment variables section:

```bash
# Server Configuration
PORT=3000

# Facebook Messenger Configuration
FB_VERIFY_TOKEN=hanlob2025dev
FB_PAGE_TOKEN=<your_facebook_page_access_token>
FB_APP_SECRET=<your_facebook_app_secret>
FB_PAGE_ID=<your_facebook_page_id>

# Database Configuration
MONGODB_URI=<your_mongodb_atlas_connection_string>

# AI Configuration
AI_PROVIDER=openai
AI_API_KEY=<your_openai_api_key>
AI_MODEL=gpt-3.5-turbo

# Dashboard Authentication
DASHBOARD_KEY=hanlob_admin_2025

# Mercado Libre API Configuration
ML_APP_ID=<your_ml_app_id>
ML_SITE_ID=MLM
ML_ACCESS_TOKEN=<your_ml_access_token>
ML_REFRESH_TOKEN=<your_ml_refresh_token>
ML_CLIENT_ID=<your_ml_client_id>
ML_CLIENT_SECRET=<your_ml_client_secret>
ML_REDIRECT_URI=<your_production_url>
```

### Deployment Steps

#### 1. Connect Repository to Railway

1. Go to https://railway.app
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Authorize Railway to access your GitHub account
5. Select the `HanlobBot` repository
6. Railway will detect the Node.js project automatically

#### 2. Configure Environment Variables

1. In your Railway project dashboard, go to "Variables"
2. Click "Raw Editor"
3. Paste all environment variables from above
4. Replace placeholder values with actual secrets
5. Click "Deploy"

#### 3. Configure Start Command (if needed)

Railway should automatically detect `npm start`, but if needed:
1. Go to "Settings" → "Deploy"
2. Set Start Command: `npm start`
3. Set Root Directory: `/bot-server` (if deploying from monorepo)

#### 4. Get Production URL

1. After deployment completes, Railway will provide a public URL
2. Copy this URL (e.g., `https://your-project.railway.app`)
3. You'll need this for Facebook webhook configuration

#### 5. Update Facebook Webhook

1. Go to Facebook Developer Portal
2. Navigate to your app → Messenger → Settings
3. Update webhook URL to: `https://your-project.railway.app/webhook`
4. Verify Token: `hanlob2025dev`
5. Subscribe to webhook fields:
   - `messages`
   - `messaging_postbacks`
   - `messaging_referrals`

### Monitoring and Logs

1. View logs in Railway dashboard: "Deployments" → Click deployment → "View Logs"
2. Monitor MongoDB connections via MongoDB Atlas
3. Check Facebook webhook deliveries in Developer Portal

### Continuous Deployment

Once configured, any push to the `main` branch will automatically trigger a new deployment on Railway.

### Production CORS Configuration

Update the CORS configuration in `index.js` to include your production dashboard URL:

```javascript
app.use(
  cors({
    origin: [
      "http://localhost:3001", // local development
      "https://your-dashboard.vercel.app" // production dashboard
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);
```

## Vercel Deployment (Dashboard)

See `/dashboard/DEPLOYMENT.md` for dashboard deployment instructions.

## Rollback Procedures

### Railway
1. Go to "Deployments" in Railway dashboard
2. Find the previous working deployment
3. Click "..." → "Redeploy"

### Emergency Stop
1. Railway dashboard → "Settings" → "Danger Zone"
2. Click "Sleep Service" to temporarily stop the bot

## Support

For issues with:
- Railway deployment: https://railway.app/help
- MongoDB Atlas: https://www.mongodb.com/docs/atlas/
- Facebook Messenger Platform: https://developers.facebook.com/docs/messenger-platform/
