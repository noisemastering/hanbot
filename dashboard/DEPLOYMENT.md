# Dashboard Deployment Guide (Vercel)

## Prerequisites
- Vercel account (https://vercel.com)
- GitHub repository pushed
- Railway bot-server deployed and running

## Environment Variables Required

Configure these in Vercel's environment variables section:

```bash
# API Configuration
REACT_APP_API_URL=https://your-bot-server.railway.app
REACT_APP_API_KEY=hanlob_admin_2025
```

## Deployment Steps

### 1. Connect Repository to Vercel

1. Go to https://vercel.com
2. Click "Add New..." → "Project"
3. Import your GitHub repository (`HanlobBot`)
4. Vercel will detect it as a monorepo

### 2. Configure Project Settings

1. **Framework Preset**: Create React App
2. **Root Directory**: Click "Edit" and select `dashboard`
3. **Build Command**: `npm run build` (default)
4. **Output Directory**: `build` (default)
5. **Install Command**: `npm install` (default)

### 3. Configure Environment Variables

1. Go to "Environment Variables" section
2. Add the following variables:
   - `REACT_APP_API_URL`: Your Railway URL (e.g., `https://hanlob-bot-production.up.railway.app`)
   - `REACT_APP_API_KEY`: `hanlob_admin_2025`
3. Make sure to set for "Production", "Preview", and "Development" environments

### 4. Deploy

1. Click "Deploy"
2. Vercel will build and deploy your dashboard
3. You'll receive a production URL (e.g., `https://hanlob-dashboard.vercel.app`)

### 5. Update Backend CORS

After deployment, update the bot-server's CORS configuration to allow your Vercel dashboard URL:

In `/bot-server/index.js`:

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

Then commit and push to trigger a Railway redeployment.

### 6. Configure Socket.IO (if needed)

If using WebSocket for real-time updates, update Socket.IO configuration in bot-server:

In `/bot-server/index.js`:

```javascript
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:3001",
      "https://your-dashboard.vercel.app"
    ],
    methods: ["GET", "POST"]
  }
});
```

## Local Development with Production API

If you want to test locally against the production API:

1. Create `.env.local` in the dashboard directory:
```bash
REACT_APP_API_URL=https://your-bot-server.railway.app
REACT_APP_API_KEY=hanlob_admin_2025
```

2. Run `npm start` as usual
3. The local dashboard will connect to the production bot-server

## Continuous Deployment

Once configured, any push to the `main` branch will automatically trigger a new deployment on Vercel.

## Custom Domain (Optional)

### Add Custom Domain to Vercel

1. Go to your project in Vercel
2. Click "Settings" → "Domains"
3. Add your custom domain (e.g., `dashboard.hanlob.com`)
4. Follow DNS configuration instructions
5. Update CORS configuration in bot-server with custom domain

## Monitoring and Logs

### Vercel Dashboard
1. View deployment logs: "Deployments" → Click deployment → "Building" or "Function Logs"
2. Monitor performance: "Analytics" tab
3. Check for errors: "Functions" tab

### Development Tools
1. Open browser console for client-side errors
2. Check Network tab for API call failures
3. Verify WebSocket connections in Network → WS tab

## Troubleshooting

### Issue: Dashboard shows "Network Error"
**Solution**: Verify `REACT_APP_API_URL` is set correctly and Railway bot-server is running

### Issue: CORS errors in browser console
**Solution**:
1. Verify Vercel dashboard URL is added to bot-server CORS configuration
2. Redeploy bot-server after updating CORS settings

### Issue: WebSocket connection fails
**Solution**:
1. Check Socket.IO CORS configuration includes Vercel URL
2. Ensure Railway allows WebSocket connections (enabled by default)

### Issue: Environment variables not updating
**Solution**:
1. Vercel requires rebuild after env var changes
2. Go to "Deployments" → Latest → "..." → "Redeploy"

## Rollback Procedures

### Vercel
1. Go to "Deployments" in Vercel dashboard
2. Find the previous working deployment
3. Click "..." → "Promote to Production"

### Emergency Stop
1. Vercel dashboard → "Settings" → "Domains"
2. Remove domain or disable deployment

## Performance Optimization

### Enable Vercel Analytics
1. Go to "Analytics" tab
2. Click "Enable Analytics"
3. Monitor Core Web Vitals and user metrics

### Enable Edge Network
Vercel automatically deploys to global CDN for optimal performance

## Support

For issues with:
- Vercel deployment: https://vercel.com/docs
- React build errors: https://create-react-app.dev/docs/troubleshooting
- CORS issues: Check both Vercel and Railway logs
