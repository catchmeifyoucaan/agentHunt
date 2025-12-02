# Health Check & Frontend Access Guide

This guide explains how to access the enhanced health endpoint and the frontend dashboard.

## Enhanced Health Endpoint

The `/health` endpoint now provides comprehensive system status information.

### Access the Health Endpoint

```bash
# Local development
curl http://localhost:3000/health

# Production server (replace with your server IP or domain)
curl http://your-server-ip:3000/health
```

### Health Response Format

The enhanced health endpoint returns detailed information about all system components:

```json
{
  "status": "healthy",
  "timestamp": "2025-11-07T07:42:13.393Z",
  "version": "v1",
  "uptime": 3600.5,
  "services": {
    "database": {
      "status": "healthy",
      "details": "Connected"
    },
    "redis": {
      "status": "healthy",
      "details": "Connected"
    },
    "queues": {
      "status": "healthy",
      "stats": {
        "discovery": {
          "waiting": 5,
          "active": 2,
          "completed": 1234,
          "failed": 12
        },
        "scanner": {
          "waiting": 15,
          "active": 5,
          "completed": 5678,
          "failed": 34
        },
        "fingerprint": {
          "waiting": 0,
          "active": 1,
          "completed": 890,
          "failed": 5
        },
        "crawl": {
          "waiting": 3,
          "active": 1,
          "completed": 456,
          "failed": 8
        },
        "confirm": {
          "waiting": 0,
          "active": 0,
          "completed": 123,
          "failed": 2
        },
        "triage": {
          "waiting": 0,
          "active": 0,
          "completed": 234,
          "failed": 1
        },
        "manager": {
          "waiting": 0,
          "active": 0,
          "completed": 45,
          "failed": 0
        },
        "bruteforce": {
          "waiting": 0,
          "active": 0,
          "completed": 0,
          "failed": 0
        },
        "interact": {
          "waiting": 0,
          "active": 0,
          "completed": 67,
          "failed": 3
        }
      }
    },
    "workers": {
      "status": "running",
      "details": "Check PM2 status for worker health"
    }
  }
}
```

### Status Values

- **status**: Overall system status
  - `healthy`: All services operational
  - `degraded`: Some services have issues but system is operational
  - `unhealthy`: Critical services are down

- **uptime**: Server uptime in seconds

- **services**: Individual service health
  - `database`: PostgreSQL connection status
  - `redis`: Redis connection status
  - `queues`: Job queue statistics for all agent types
  - `workers`: Worker process status

## Frontend Dashboard Access

### Local Development

The frontend runs on port **3001** by default.

```bash
# Start the frontend development server
cd frontend
npm run dev

# Access the dashboard
# Open in browser: http://localhost:3001
```

### Production Deployment

The frontend is **not yet deployed** in your production setup. You need to:

#### Option 1: Deploy Frontend on Same Server (Recommended)

1. **Build the frontend:**
   ```bash
   cd /opt/agenthunt/frontend
   npm run build
   ```

2. **Add frontend to PM2 ecosystem:**

   Edit `/opt/agenthunt/ecosystem.config.js` and add:
   ```javascript
   {
     name: 'agenthunt-frontend',
     script: 'node_modules/.bin/next',
     args: 'start -p 3001',
     cwd: '/opt/agenthunt/frontend',
     instances: 1,
     exec_mode: 'fork',
     env_file: '/opt/agenthunt/.env',
     env: {
       NODE_ENV: 'production',
       NEXT_PUBLIC_API_URL: 'http://localhost:3000',
       NEXT_PUBLIC_WS_URL: 'ws://localhost:3000'
     },
     error_file: './logs/frontend-error.log',
     out_file: './logs/frontend-out.log',
     log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
     merge_logs: true,
     autorestart: true,
     max_restarts: 10,
     min_uptime: '10s',
     max_memory_restart: '300M',
   }
   ```

3. **Open port 3001 in firewall:**
   ```bash
   # Digital Ocean Firewall
   # Go to: Networking > Firewalls > Your Firewall
   # Add Inbound Rule:
   # - Type: Custom
   # - Protocol: TCP
   # - Port: 3001
   # - Sources: All IPv4, All IPv6
   ```

4. **Restart PM2 with updated config:**
   ```bash
   cd /opt/agenthunt
   pm2 reload ecosystem.config.js
   pm2 save
   ```

5. **Access the frontend:**
   ```
   http://your-server-ip:3001
   ```

#### Option 2: Use Nginx Reverse Proxy (Production Best Practice)

This is the recommended approach for production as it:
- Serves both API and frontend on port 80/443
- Enables HTTPS with SSL certificates
- Better security and performance

1. **Install Nginx:**
   ```bash
   sudo apt update
   sudo apt install nginx -y
   ```

2. **Create Nginx configuration:**
   ```bash
   sudo nano /etc/nginx/sites-available/agenthunt
   ```

   Add this configuration:
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;  # Replace with your domain or IP

       # Frontend
       location / {
           proxy_pass http://localhost:3001;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }

       # API
       location /api {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       }

       # Health endpoint
       location /health {
           proxy_pass http://localhost:3000;
       }

       # WebSocket for events
       location /events {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
       }
   }
   ```

3. **Enable the configuration:**
   ```bash
   sudo ln -s /etc/nginx/sites-available/agenthunt /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

4. **Update frontend environment variables:**

   Edit `/opt/agenthunt/.env` and add:
   ```bash
   NEXT_PUBLIC_API_URL=http://your-domain.com
   NEXT_PUBLIC_WS_URL=ws://your-domain.com
   ```

5. **Access via Nginx:**
   ```
   http://your-domain.com
   ```

   Now:
   - Frontend: `http://your-domain.com/`
   - API: `http://your-domain.com/api/v1/`
   - Health: `http://your-domain.com/health`
   - WebSocket: `ws://your-domain.com/events`

#### Option 3: Enable HTTPS with Let's Encrypt (Recommended for Production)

Once Nginx is set up:

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Get SSL certificate (replace with your domain)
sudo certbot --nginx -d your-domain.com

# Auto-renewal is configured automatically
# Test renewal:
sudo certbot renew --dry-run
```

Now access via HTTPS:
```
https://your-domain.com
```

## Firewall Configuration Summary

For your production server, you need these ports open:

### Current Setup (API Only)
- ✅ Port 3000: Backend API

### Add for Frontend
- Port 3001: Frontend dashboard (if not using Nginx)

### Using Nginx (Recommended)
- Port 80: HTTP (Nginx proxy)
- Port 443: HTTPS (Nginx proxy with SSL)
- Keep ports 3000 and 3001 closed to public (only allow localhost)

## Troubleshooting

### Health Endpoint Shows Unhealthy Services

**Database unhealthy:**
```bash
# Check PostgreSQL connection
psql "postgresql://doadmin:YOUR_PASSWORD@your-db.ondigitalocean.com:25060/defaultdb?sslmode=require"

# Verify .env has correct credentials
cat /opt/agenthunt/.env | grep POSTGRES
```

**Redis unhealthy:**
```bash
# Check Redis connection
redis-cli -h your-redis.ondigitalocean.com -p 25061 -a YOUR_PASSWORD --tls ping

# Verify .env has correct credentials
cat /opt/agenthunt/.env | grep REDIS
```

**Queues show errors:**
```bash
# Check workers are running
pm2 status

# Check worker logs
pm2 logs agenthunt-workers --lines 50
```

### Frontend Not Accessible

**Port not open:**
```bash
# Test if port is accessible
telnet your-server-ip 3001

# Check firewall rules in Digital Ocean dashboard
# Networking > Firewalls > Your Firewall
```

**Frontend not running:**
```bash
# Check PM2 status
pm2 status

# Check frontend logs
pm2 logs agenthunt-frontend --lines 50

# Manually test frontend
cd /opt/agenthunt/frontend
npm run start
```

**Environment variables not set:**
```bash
# Verify environment variables
pm2 env agenthunt-frontend | grep NEXT_PUBLIC

# If missing, update ecosystem.config.js and reload
pm2 reload ecosystem.config.js
```

## Next Steps

1. ✅ Backend API running on port 3000
2. ✅ Enhanced health endpoint available
3. ⏳ Deploy frontend to production (choose option above)
4. ⏳ Set up Nginx reverse proxy (recommended)
5. ⏳ Enable HTTPS with Let's Encrypt
6. ⏳ Configure domain name

Need help with any of these steps? Follow the detailed instructions above or refer to:
- [DEPLOYMENT.md](../DEPLOYMENT.md) - Full deployment guide
- [API.md](./API.md) - API documentation
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
