# miningos-wrk-minerpool-luxor

Luxor mining pool worker for MiningOS. This worker integrates with the Luxor Mining Pool API to collect and store mining statistics, worker data, and transaction history.

## Installation

```bash
npm install
```

## Configuration

Copy the example configuration files and update with your settings:

```bash
cp config/luxor.json.example config/luxor.json
cp config/common.json.example config/common.json
```

### Luxor Configuration (`config/luxor.json`)

| Field | Type | Description |
|-------|------|-------------|
| `apiUrl` | string | Luxor API base URL (default: `https://app.luxor.tech/api`) |
| `apiKey` | string | Your Luxor API key |
| `currencyType` | string | Currency type: `BTC`, `LTC_DOGE`, `SC`, `ZEC` (default: `BTC`) |
| `subaccountNames` | string[] | Optional list of subaccount names to filter |
| `siteId` | string | Optional site ID to filter |
| `pageSize` | number | Page size for paginated requests (default: 100) |
| `yearlyBalancesRefreshCurrentMs` | number | Refresh interval for current-month yearly balances (default: 60000) |
| `yearlyBalancesRefreshFullMs` | number | Refresh interval for full yearly balances (default: 86400000) |

## Usage

Start the worker:

```bash
node worker.js --wtype=luxor.rack.minerpool --rack=<rack-id>
```

## API Endpoints Used

| Endpoint | Purpose | Frequency |
|----------|---------|-----------|
| `GET /v2/pool/summary/{currency}` | Balance, hashrate, efficiency, revenue | Every 1 minute |
| `GET /v2/pool/workers/{currency}` | Worker list and status | Every 5 minutes |
| `GET /v2/pool/transactions/{currency}` | Transaction history | Daily |

## Data Collection Schedule

| Interval | Task | Data Collected |
|----------|------|----------------|
| 1 minute | `fetchStats()` | Hashrate, efficiency, uptime, revenue, balance |
| 5 minutes | `fetchWorkers()` + `saveStats()` | Worker list, persist stats |
| 24 hours | `fetchTransactions()` + `saveWorkers()` | Daily transactions, worker snapshots |

## RPC Interface

The worker exposes a `getWrkExtData` RPC method with the following query keys:

| Key | Description |
|-----|-------------|
| `stats` | Current pool statistics |
| `workers` | Current worker list (supports pagination) |
| `workers-count` | Total/active worker counts |
| `stats-history` | Historical stats (supports interval aggregation) |
| `transactions` | Transaction history (supports date range) |

### Query Parameters

- `start`/`end` - Timestamp filtering (milliseconds)
- `offset`/`limit` - Pagination
- `interval` - Aggregation interval (`5m`, `30m`, `3h`, `1D`)
- `fields` - Field projection
- `aggrHourly` - Aggregate transactions by hour (boolean)

## Database Schema

### Stats Database

```javascript
{
  ts: timestamp,
  stats: [{
    username,
    timestamp,
    balance,
    revenue_24h,
    revenue_all_time,
    hashrate,
    hashrate_1h,
    hashrate_24h,
    hashrate_stale_1h,
    hashrate_stale_24h,
    efficiency,
    uptime_24h,
    active_workers_count,
    worker_count,
    hashprice,
    yearlyBalances,
    subaccounts
  }]
}
```

### Workers Database

```javascript
{
  ts: timestamp,
  workers: [{
    id,
    name,
    subaccount_name,
    online,
    last_updated,
    hashrate,
    efficiency,
    stale_shares,
    rejected_shares,
    firmware,
    poolType
  }]
}
```

### Transactions Database

```javascript
{
  ts: timestamp,
  transactions: [{
    currency_type,
    date_time,
    address_name,
    subaccount_name,
    transaction_category,
    currency_amount,
    usd_equivalent,
    transaction_id,
    transaction_type
  }]
}
```

## Testing

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration

# Run with coverage
npm run test:coverage
```
