# HanlobBot Deployment Configuration

## Architecture Overview

### Backend (bot-server)
- **Platform**: Railway
- **Production URL**: https://hanbot-production.up.railway.app
- **Purpose**: Facebook Messenger bot, API endpoints, click tracking, webhook handling
- **Port**: 3000

### Frontend (dashboard)
- **Platform**: Vercel
- **Purpose**: Admin dashboard for managing campaigns, products, analytics
- **Tech**: React

### Development Environment
- **Localhost**: Only for development
- **Backend Dev**: http://localhost:3000
- **Frontend Dev**: http://localhost:3001

## Environment Variables

### Critical Variables for Production (Railway)
- `BASE_URL` - **MUST** be set to `https://hanbot-production.up.railway.app` for click tracking to work
- `MONGODB_URI` - MongoDB Atlas connection string
- `FB_PAGE_TOKEN` - Facebook page access token
- `AI_API_KEY` - OpenAI API key
- Other FB/ML tokens as needed

### Railway Deployment
1. Push changes to GitHub
2. Railway auto-deploys from connected repository
3. Environment variables are set in Railway dashboard
4. **Do not rely on .env file for production** - Railway uses its own environment variables

### Vercel Deployment
1. Push changes to GitHub (dashboard folder)
2. Vercel auto-deploys from connected repository
3. Environment variables are set in Vercel dashboard

## Click Tracking

### How it works
1. Bot generates tracking links: `https://hanbot-production.up.railway.app/r/{clickId}`
2. User clicks link in Facebook Messenger
3. Railway backend logs the click (sets `clicked: true`, records metadata)
4. User is redirected to Mercado Libre product page
5. Dashboard shows click statistics

### Important Notes
- **BASE_URL must be set correctly in Railway** or click tracking won't work
- Localhost links (`http://localhost:3000/r/...`) will NOT work for users
- Only links with the production Railway URL will be tracked properly

## Troubleshooting

### Click tracking shows 0 clicks
- Check that `BASE_URL` is set to Railway production URL in Railway dashboard
- Verify links sent to users start with `https://hanbot-production.up.railway.app/r/`
- Check Railway logs for click tracking events

### Bot not responding
- Check Railway deployment status
- Verify Facebook webhook is pointing to Railway URL
- Check Railway logs for errors

## Last Updated
November 18, 2025
