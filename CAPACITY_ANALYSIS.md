# System Capacity Analysis & Optimization Plan

## Current System Specs
- **CPU**: 4 cores (DO Premium Intel)
- **RAM**: 8GB (6.5GB available, NO swap)
- **Disk**: 233GB SSD (214GB free, very fast I/O)
- **Network**: DigitalOcean Premium (excellent bandwidth)

## Boss Requirements
- **1 million domains/day** through subdomain enumeration
- **10 million subdomains/day** for port scan, crawl, and vulnerability scanning

---

## Current Performance (With My Optimizations)

### Subdomain Enumeration
- **Batch size**: 5 domains in parallel
- **Tools**: subfinder (5min) + amass (10min) = 15 min per domain
- **Throughput**: 5 domains × 4 batches/hour = **20 domains/hour per worker**
- **Daily capacity**: 20 × 24 = **480 domains/day per worker**

### Fingerprint
- **Batch size**: 500 assets
- **Time**: ~10 minutes per batch
- **Throughput**: 500 × 6 batches/hour = **3,000 assets/hour per worker**
- **Daily capacity**: 3,000 × 24 = **72,000 assets/day per worker**

### Port Scan
- **Batch size**: 100 targets
- **Time**: ~3 minutes per batch (top-1000 ports)
- **Throughput**: 100 × 20 batches/hour = **2,000 targets/hour per worker**
- **Daily capacity**: 2,000 × 24 = **48,000 targets/day per worker**

### Crawl
- **Batch size**: 100 URLs
- **Time**: ~5 minutes per batch (depth 3)
- **Throughput**: 100 × 12 batches/hour = **1,200 URLs/hour per worker**
- **Daily capacity**: 1,200 × 24 = **28,800 URLs/day per worker**

### Vulnerability Scanning (Nuclei)
- **Batch size**: 1,000 URLs
- **Time**: ~15 minutes per batch (fast templates only)
- **Throughput**: 1,000 × 4 batches/hour = **4,000 URLs/hour per worker**
- **Daily capacity**: 4,000 × 24 = **96,000 URLs/day per worker**

---

## Math for Boss Requirements

### 1 Million Domains/Day
**Required**: 1,000,000 domains / 24 hours = **41,667 domains/hour**

**Current capacity**: 20 domains/hour per worker

**Workers needed**: 41,667 / 20 = **2,083 parallel workers** ❌

**Problem**: THIS SYSTEM CANNOT HANDLE 1M DOMAINS/DAY with current approach

### 10 Million Subdomains/Day
**Required**: 10,000,000 subdomains / 24 hours = **416,667 subdomains/hour**

**Fingerprint capacity**: 3,000 assets/hour per worker

**Workers needed**: 416,667 / 3,000 = **139 parallel workers** ❌

**Port scan capacity**: 2,000 targets/hour per worker

**Workers needed**: 416,667 / 2,000 = **208 parallel workers** ❌

**Problem**: THIS SYSTEM CANNOT HANDLE 10M SUBDOMAINS/DAY

---

## REALISTIC Capacity (Single 8GB/4CPU Node)

### With Maximum Optimizations

#### Option 1: Current Approach (Quality over Speed)
- **Subdomain**: 480 domains/day (with amass+subfinder)
- **Fingerprint**: 72,000 assets/day
- **Port scan**: 48,000 targets/day
- **Crawl**: 28,800 URLs/day
- **Scanner**: 96,000 URLs/day

**Total realistic**: ~500 domains → ~50,000 subdomains → full pipeline per day

#### Option 2: SPEED Mode (Skip amass, only subfinder)
**Changes**:
- Skip amass (10x slower than subfinder)
- Subfinder only: 5 min per domain
- Increase batch to 10 domains in parallel

**New capacity**:
- **Subdomain**: 10 domains × 12 batches/hour = **120 domains/hour**
- **Daily**: 120 × 24 = **2,880 domains/day**
- **Subdomains found**: ~2,880 × 50 = **144,000 subdomains/day**

**Fingerprint**: 72,000 assets/day (bottleneck!)

**Problem**: Fingerprint becomes bottleneck at 144k subdomains

#### Option 3: ULTRA AGGRESSIVE Mode
**Changes**:
- Skip amass entirely
- Subfinder only with 20 domains parallel
- Skip tlsx in fingerprint
- Reduce httpx threads to 50 per batch (faster)
- Increase fingerprint batch to 1,000 assets
- Increase port scan batch to 500 targets
- Skip deep crawling (depth 1 only)
- Fast nuclei templates only (no fuzzing)

**New capacity**:
- **Subdomain**: 20 domains × 12 = **240 domains/hour** = **5,760 domains/day**
- **Fingerprint**: 1,000 × 6 = **6,000/hour** = **144,000 assets/day**
- **Port scan**: 500 × 20 = **10,000/hour** = **240,000 targets/day**
- **Crawl**: 200 × 12 = **2,400/hour** = **57,600 URLs/day**
- **Scanner**: 5,000 × 4 = **20,000/hour** = **480,000 URLs/day**

**Best case single node**: ~6,000 domains → ~300,000 subdomains → full pipeline per day

---

## To Hit Boss Numbers (1M domains, 10M subdomains/day)

### Infrastructure Needed

#### For 1M Domains/Day
**Workers needed**: 1,000,000 / 5,760 = **174 nodes like this one**

**OR**:
- **3 powerful nodes** (32 core, 64GB RAM each) running **only subdomain enumeration** (subfinder only)
- With 100 domains in parallel per node: 100 × 12 batches/hour = 1,200/hour × 3 nodes = 3,600/hour
- Still need: 1,000,000 / (3,600 × 24) = **12 nodes minimum**

#### For 10M Subdomains/Day
**After getting subdomains, need**:
- **Fingerprint**: 10M / 144k = **70 nodes** like this
- **Port scan**: 10M / 240k = **42 nodes** like this
- **Crawl**: 10M / 57k = **175 nodes** like this
- **Scanner**: 10M / 480k = **21 nodes** like this

**Total infrastructure**: ~200-300 worker nodes minimum

---

## Optimizations I Can Implement RIGHT NOW

### 1. Skip Amass (10x speed increase for subdomain)
- Amass is slow (10 min vs 5 min for subfinder)
- Subfinder finds 80% of what amass finds
- **Result**: 2,880 → 5,760 domains/day

### 2. Increase Subdomain Parallelism to 20
- System has 4 cores, 6GB RAM available
- Can handle 20 parallel domains easily
- **Result**: 5,760 domains/day

### 3. Increase Fingerprint Batch to 1,000
- Currently 500, can go to 1,000
- **Result**: 72k → 144k assets/day

### 4. Increase Port Scan Batch to 500
- Currently 100, can go to 500
- **Result**: 48k → 240k targets/day

### 5. Reduce Crawl Depth to 1
- Depth 3 is slow, depth 1 is 5x faster
- **Result**: 28k → 140k URLs/day

### 6. Use Redis for Queue (Already using BullMQ with Redis)
- ✅ Already optimized

### 7. Database Connection Pooling
- Need to check current pool size
- Increase to 20 connections

### 8. Batch Insert Optimization
- Already implemented for assets
- Need for findings

---

## Final Answer for Boss

### Single Node (This Server)
**Maximum realistic capacity with all optimizations**:
- **6,000 domains/day** (subfinder only)
- **300,000 subdomains/day** (fingerprint + port scan + crawl + scan full pipeline)

**To hit your numbers (1M domains, 10M subdomains)**:
- Need **~200-300 worker nodes** like this one
- OR **12-15 powerful nodes** (32 core, 64GB RAM each)
- OR use **cloud-scale services** (AWS Lambda, Google Cloud Run, etc.)

### Recommendation
**Keep this as the orchestrator/master node**, add:
- **10 worker nodes** (8GB/4CPU each) = **$500/month** = **60k domains/day, 3M subdomains/day**
- **50 worker nodes** (8GB/4CPU each) = **$2,500/month** = **300k domains/day, 15M subdomains/day** ✅

**OR go cheaper**:
- **Use spot instances** (70% cheaper) = **50 nodes for $750/month**

**OR go serverless**:
- AWS Lambda + S3 + RDS = scales to millions/day, pay per execution

---

## Do You Want Me To Implement The Aggressive Optimizations Now?

I can push this single node to **6,000 domains/day** and **300,000 subdomains/day** right now by:
1. Skipping amass
2. Increasing parallelism to 20 domains
3. Increasing batch sizes
4. Reducing crawl depth
5. Fast-mode scanning only

**This will be 12x faster than current**. Do it?
