# AgentHunt Deployment Guide

Complete deployment guide for production and development environments.

## Quick Deploy (Docker Compose)

```bash
# 1. Clone repository
git clone https://github.com/yourusername/agentHunt.git
cd agentHunt

# 2. Configure environment
cp .env.example .env
# Edit .env with your API keys

# 3. Start services
cd infrastructure/docker
docker-compose up -d

# 4. Verify
curl http://localhost:3000/health
```

## Production Deployment Options

### Option 1: PM2 (Node.js Process Manager)

**Current Production Setup**: The production server at `165.227.108.120:3000` uses PM2.

#### Quick Deploy

```bash
ssh root@165.227.108.120
cd /opt/agenthunt
./deploy-production.sh claude/agent-orchestration-full-spec-011CUrbUhn2v28Amnbs5b8Qu
```

#### Manual PM2 Deployment

```bash
# 1. SSH into production server
ssh root@165.227.108.120

# 2. Navigate to app directory
cd /opt/agenthunt

# 3. Pull latest code
git fetch origin
git checkout claude/agent-orchestration-full-spec-011CUrbUhn2v28Amnbs5b8Qu
git pull origin claude/agent-orchestration-full-spec-011CUrbUhn2v28Amnbs5b8Qu

# 4. Install dependencies and build
cd backend
npm install --production
npm run build

# 5. Restart services
cd /opt/agenthunt
pm2 restart ecosystem.config.js --update-env

# 6. Verify
pm2 status
pm2 logs agenthunt-api --lines 50
```

#### PM2 Management Commands

```bash
# Start services
pm2 start ecosystem.config.js

# Restart services
pm2 restart all
pm2 restart agenthunt-api
pm2 restart agenthunt-workers

# Stop services
pm2 stop all
pm2 stop agenthunt-api

# View status
pm2 status
pm2 monit

# View logs
pm2 logs
pm2 logs agenthunt-api
pm2 logs agenthunt-workers --lines 100

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

#### Troubleshooting 404 Errors

If you encounter 404 errors on API endpoints (e.g., `/api/v1/settings`):

1. **Check if the route file exists in dist:**
   ```bash
   ls -la /opt/agenthunt/backend/dist/backend/src/api/routes/
   ```

2. **Verify PM2 is running the latest code:**
   ```bash
   pm2 restart ecosystem.config.js --update-env
   ```

3. **Check PM2 logs for errors:**
   ```bash
   pm2 logs agenthunt-api --err
   ```

4. **Test endpoint locally on server:**
   ```bash
   curl -X GET http://localhost:3000/api/v1/settings
   ```

5. **Full rebuild if needed:**
   ```bash
   cd /opt/agenthunt/backend
   npm run build:clean
   cd /opt/agenthunt
   pm2 restart all
   ```

6. **Use diagnostic script:**
   ```bash
   cd /opt/agenthunt
   ./check-production.sh
   ```

### Option 2: Docker Swarm

```bash
# Initialize swarm
docker swarm init

# Deploy stack
docker stack deploy -c infrastructure/docker/docker-compose.yml agenthunt

# Scale workers
docker service scale agenthunt_workers=5
```

### Option 2: Kubernetes

```bash
# Apply manifests (coming soon)
kubectl apply -f infrastructure/k8s/

# Or use Helm
helm install agenthunt ./infrastructure/helm/
```

### Option 3: Cloud Platforms

#### AWS ECS

1. Build and push images:
```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ECR_URL
docker build -f infrastructure/docker/Dockerfile.api -t YOUR_ECR_URL/agenthunt-api:latest .
docker push YOUR_ECR_URL/agenthunt-api:latest
```

2. Create ECS task definitions and services (Terraform configs in `infrastructure/terraform/`)

#### Google Cloud Run

```bash
gcloud builds submit --config cloudbuild.yaml
gcloud run deploy agenthunt-api --image gcr.io/PROJECT_ID/agenthunt-api
```

## Infrastructure Requirements

### Minimum Specs

- **API Server**: 2 vCPU, 4 GB RAM
- **Workers**: 4 vCPU, 8 GB RAM (per worker)
- **PostgreSQL**: 2 vCPU, 4 GB RAM, 50 GB SSD
- **Redis**: 1 vCPU, 2 GB RAM
- **MinIO**: 2 vCPU, 4 GB RAM, 100 GB SSD

### Recommended Specs (Production)

- **API Server**: 4 vCPU, 8 GB RAM (2+ replicas)
- **Workers**: 8 vCPU, 16 GB RAM (5+ replicas)
- **PostgreSQL**: 4 vCPU, 16 GB RAM, 200 GB SSD (managed RDS)
- **Redis**: 2 vCPU, 4 GB RAM (managed ElastiCache)
- **S3**: AWS S3 or compatible

## Configuration

### Environment Variables

Required variables:

```bash
# API Keys
ANTHROPIC_API_KEY=sk-ant-xxx
CHAOS_API_KEY=xxx

# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=agenthunt
POSTGRES_PASSWORD=changeme
POSTGRES_DB=agenthunt

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# S3
S3_ENDPOINT=https://s3.amazonaws.com
S3_ACCESS_KEY=AKIAXXXXXXXX
S3_SECRET_KEY=xxxxxxxx
S3_BUCKET=agenthunt-artifacts
```

Optional variables:

```bash
# Telegram Notifications
TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_CRITICAL_CHANNEL=-1001234567890

# Platform Integrations
HACKERONE_API_KEY=xxx
BUGCROWD_API_KEY=xxx

# Feature Flags
ENABLE_BRUTEFORCE=true
ENABLE_PORT_SCANNING=true
ENABLE_FUZZING=true
```

### Database Migration

```bash
# Run migrations
docker exec -it agenthunt-api npm run migrate

# Or manually
psql -h localhost -U agenthunt -d agenthunt -f backend/src/models/database.sql
```

### SSL/TLS Setup

Use a reverse proxy (Nginx, Traefik, or load balancer):

```nginx
server {
    listen 443 ssl http2;
    server_name agenthunt.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /events {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
    }
}
```

## Monitoring

### Health Checks

```bash
# API health
curl http://localhost:3000/health

# Database health
psql -h localhost -U agenthunt -c "SELECT 1"

# Redis health
redis-cli ping
```

### Metrics (Prometheus)

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'agenthunt-api'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
```

### Logging

Logs are output to stdout in JSON format. Collect with:

- **ELK Stack**: Elasticsearch + Logstash + Kibana
- **Loki**: Grafana Loki
- **CloudWatch**: AWS CloudWatch Logs
- **Stackdriver**: Google Cloud Logging

## Backup & Recovery

### Database Backup

```bash
# Backup
pg_dump -h localhost -U agenthunt agenthunt > backup_$(date +%Y%m%d).sql

# Restore
psql -h localhost -U agenthunt agenthunt < backup_20250101.sql
```

### S3 Backup

```bash
# Sync to backup bucket
aws s3 sync s3://agenthunt-artifacts s3://agenthunt-backup --source-region us-east-1 --region us-west-2
```

## Scaling

### Horizontal Scaling

Scale workers independently:

```bash
# Docker Compose
docker-compose up -d --scale workers=10

# Kubernetes
kubectl scale deployment agenthunt-workers --replicas=10
```

### Vertical Scaling

Update resource limits:

```yaml
# docker-compose.yml
services:
  workers:
    deploy:
      resources:
        limits:
          cpus: '8'
          memory: 16G
```

## Security Checklist

- [ ] Change default passwords
- [ ] Use strong JWT secrets
- [ ] Enable SSL/TLS
- [ ] Configure firewalls
- [ ] Use managed databases (RDS, etc.)
- [ ] Enable audit logging
- [ ] Set up monitoring and alerts
- [ ] Regular security updates
- [ ] Backup encryption
- [ ] API rate limiting

## Troubleshooting

### Workers not processing jobs

```bash
# Check worker logs
docker logs agenthunt-workers

# Check Redis connection
docker exec agenthunt-workers redis-cli -h redis ping

# Check queue status
curl http://localhost:3000/api/v1/jobs/stats/queues
```

### Database connection errors

```bash
# Test connection
docker exec agenthunt-api psql -h postgres -U agenthunt -c "SELECT 1"

# Check connection pool
docker logs agenthunt-api | grep "database"
```

### Out of memory errors

```bash
# Increase worker memory
docker-compose up -d --scale workers=5 --memory=8g

# Or reduce concurrency
# Edit .env: WORKER_CONCURRENCY=3
```

## Support

- Issues: https://github.com/yourusername/agentHunt/issues
- Discord: https://discord.gg/agenthunt
- Email: support@agenthunt.io
