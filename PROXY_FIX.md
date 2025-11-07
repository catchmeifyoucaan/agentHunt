# Fix for Settings API Proxy Error (ECONNRESET)

## Problem
Frontend is getting "socket hang up" errors when accessing `/api/v1/settings` because:
1. Backend server is not running locally
2. Frontend is trying to proxy to production server (165.227.108.120:3000) which returns 403 Forbidden

## Solution: Run Backend Locally

### Step 1: Update Your .env File
Edit `/home/user/agentHunt/.env` and change the PORT:

```bash
# Change this line:
PORT=3001

# To this:
PORT=3000
```

### Step 2: Start the Backend Server
```bash
cd /home/user/agentHunt/backend
npm run dev
```

The backend will start on port 3000 with:
- API endpoints at http://localhost:3000/api/v1/*
- Settings endpoint at http://localhost:3000/api/v1/settings
- Health check at http://localhost:3000/health

### Step 3: Verify Backend is Running
In a new terminal:
```bash
curl http://localhost:3000/api/v1/settings
```

You should see JSON response with settings.

### Step 4: Restart Your Frontend
Your Next.js frontend should now successfully proxy requests to the local backend.

## Note About Redis Errors
You'll see Redis connection errors in the backend logs. This is expected if Redis isn't running. The backend has fallback mechanisms:
- Settings use file-based storage at `backend/data/settings.json`
- Most endpoints will work without Redis (except job queue features)

## To Run Redis (Optional)
If you want full functionality:
```bash
# Install and start Redis
sudo apt-get install redis-server
sudo systemctl start redis-server
```

Or use Docker:
```bash
docker run -d -p 6379:6379 redis:7-alpine
```

## Alternative: Update Frontend Proxy
If you want the frontend to use a different backend URL, update:
`/home/user/agentHunt/frontend/next.config.js`

Change the `NEXT_PUBLIC_API_URL` environment variable or the rewrites destination.
