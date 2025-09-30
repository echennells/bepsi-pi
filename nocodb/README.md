# NocoDB Test Setup

## Quick Start

```bash
# Start NocoDB
docker-compose up -d

# Check logs
docker-compose logs -f

# Stop NocoDB
docker-compose down
```

## Access
- **Web Interface**: http://localhost:8080
- **API Base**: http://localhost:8080/api/v1/

## First Time Setup
1. Visit http://localhost:8080
2. Create admin account
3. Create workspace/base called "bepsi"
4. Create table called "purchases" with columns:
   - `currency` (SingleLineText)
   - `timestamp` (DateTime)
   - `item` (SingleLineText)
5. Go to Settings → API Tokens → Create new token
6. Copy token for vending machine .env file

## Vending Machine Integration
Update your `.env` file:
```
NOCODB_API_TOKEN=your_new_token_here
NOCO_CREATE_NEW_PURCHASE_URL=http://localhost:8080/api/v1/db/data/v1/bepsi/purchases
```

## Data Storage
- Database file: `./data/noco.db` (SQLite)
- Persistent across container restarts
- Easy to backup (just copy the `data/` folder)

## Memory Usage
- Configured with 512MB limit
- Should use ~100-200MB in practice
- Perfect for vending machine scale

## API Testing
```bash
# Test health
curl http://localhost:8080/api/v1/health

# Create test purchase (after setup)
curl -X POST http://localhost:8080/api/v1/db/data/v1/bepsi/purchases \
  -H "xc-token: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currency":"test","timestamp":"2025-09-30T20:00:00Z","item":"coke"}'
```