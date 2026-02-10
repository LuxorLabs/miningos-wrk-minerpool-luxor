'use strict'

const test = require('brittle')
const {
  transformWorkerData,
  getWorkersStats,
  extractMiningRevenue,
  extractBalance,
  extractHashprice,
  transformSummaryToStats,
  getMonthlyDateRanges,
  isCurrentMonth,
  convertMsToSeconds,
  formatDateForApi,
  getTimeRanges
} = require('../../workers/lib/utils')

test('transformWorkerData: should transform Luxor worker to MiningOS format', (t) => {
  const worker = {
    id: 'worker-123',
    name: 'miner1',
    subaccount_name: 'subaccount1',
    status: 'ACTIVE',
    last_share_time: '2024-01-01T00:00:00Z',
    hashrate: 100000000000,
    efficiency: 0.98,
    stale_shares: 0.01,
    rejected_shares: 0.005,
    firmware: '1.0.0'
  }

  const result = transformWorkerData(worker)

  t.is(result.id, 'worker-123')
  t.is(result.name, 'miner1')
  t.is(result.username, 'subaccount1')
  t.is(result.online, 1)
  t.is(result.last_updated, '2024-01-01T00:00:00Z')
  t.is(result.hashrate, 100000000000)
  t.is(result.stale_shares, 0.01)
  t.is(result.rejected_shares, 0.005)
  t.is(result.firmware, '1.0.0')
})

test('transformWorkerData: should handle INACTIVE status', (t) => {
  const worker = {
    id: 'worker-123',
    name: 'miner1',
    status: 'INACTIVE',
    hashrate: 0
  }

  const result = transformWorkerData(worker)
  t.is(result.online, 0)
})

test('transformWorkerData: should handle missing fields', (t) => {
  const worker = {
    id: 'worker-123',
    name: 'miner1',
    status: 'ACTIVE'
  }

  const result = transformWorkerData(worker)
  t.is(result.hashrate, 0)
  t.is(result.stale_shares, 0)
  t.is(result.rejected_shares, 0)
  t.is(result.firmware, '')
})

test('getWorkersStats: should transform array of workers', (t) => {
  const workers = [
    { id: 'w1', name: 'miner1', status: 'ACTIVE', hashrate: 100 },
    { id: 'w2', name: 'miner2', status: 'INACTIVE', hashrate: 0 }
  ]

  const result = getWorkersStats(workers)

  t.is(result.length, 2)
  t.is(result[0].online, 1)
  t.is(result[1].online, 0)
})

test('getWorkersStats: should handle empty array', (t) => {
  const result = getWorkersStats([])
  t.is(result.length, 0)
  t.ok(Array.isArray(result))
})

test('getWorkersStats: should handle non-array input', (t) => {
  const result = getWorkersStats(null)
  t.is(result.length, 0)
  t.ok(Array.isArray(result))
})

test('extractMiningRevenue: should extract MINING revenue from array', (t) => {
  const revenueArray = [
    { revenue_type: 'MINING', revenue: 0.5 },
    { revenue_type: 'REFERRAL', revenue: 0.1 }
  ]

  const result = extractMiningRevenue(revenueArray)
  t.is(result, 0.5)
})

test('extractMiningRevenue: should return 0 when no MINING revenue', (t) => {
  const revenueArray = [
    { revenue_type: 'REFERRAL', revenue: 0.1 }
  ]

  const result = extractMiningRevenue(revenueArray)
  t.is(result, 0)
})

test('extractMiningRevenue: should handle non-array input', (t) => {
  t.is(extractMiningRevenue(null), 0)
  t.is(extractMiningRevenue(undefined), 0)
  t.is(extractMiningRevenue({}), 0)
})

test('extractBalance: should extract balance for currency', (t) => {
  const balanceArray = [
    { currency_type: 'BTC', revenue: 1.5 },
    { currency_type: 'LTC', revenue: 10 }
  ]

  t.is(extractBalance(balanceArray, 'BTC'), 1.5)
  t.is(extractBalance(balanceArray, 'LTC'), 10)
})

test('extractBalance: should return 0 when currency not found', (t) => {
  const balanceArray = [
    { currency_type: 'BTC', revenue: 1.5 }
  ]

  t.is(extractBalance(balanceArray, 'ETH'), 0)
})

test('extractBalance: should default to BTC', (t) => {
  const balanceArray = [
    { currency_type: 'BTC', revenue: 1.5 }
  ]

  t.is(extractBalance(balanceArray), 1.5)
})

test('extractHashprice: should extract hashprice for currency', (t) => {
  const hashpriceArray = [
    { currency_type: 'BTC', value: 0.00059 }
  ]

  t.is(extractHashprice(hashpriceArray, 'BTC'), 0.00059)
})

test('extractHashprice: should handle non-array input', (t) => {
  t.is(extractHashprice(null), 0)
})

test('transformSummaryToStats: should transform summary to stats format', (t) => {
  const summary = {
    hashrate_5m: '1000000000000',
    hashrate_1h: '800000000000',
    hashrate_24h: '950000000000',
    hashrate_stale_1h: '400000000000',
    hashrate_stale_24h: '300000000000',
    efficiency_5m: 0.98,
    uptime_24h: 0.99,
    active_miners: 100,
    revenue_24h: [{ revenue_type: 'MINING', revenue: 0.5 }],
    revenue_all_time: [{ revenue_type: 'MINING', revenue: 10 }],
    balance: [{ currency_type: 'BTC', revenue: 1.5 }],
    hashprice: [{ currency_type: 'BTC', value: 0.00059 }],
    subaccounts: [{ name: 'sub1' }]
  }

  const result = transformSummaryToStats(summary)

  t.is(result.hashrate, 1000000000000)
  t.is(result.hashrate_1h, 800000000000)
  t.is(result.hashrate_24h, 950000000000)
  t.is(result.hashrate_stale_1h, 400000000000)
  t.is(result.hashrate_stale_24h, 300000000000)
  t.is(result.efficiency, 0.98)
  t.is(result.uptime_24h, 0.99)
  t.is(result.active_workers_count, 100)
  t.is(result.revenue_24h, 0.5)
  t.is(result.revenue_all_time, 10)
  t.is(result.balance, 1.5)
  t.is(result.hashprice, 0.00059)
  t.ok(result.timestamp > 0)
})

test('getMonthlyDateRanges: should generate correct date ranges', (t) => {
  const months = 3
  const result = getMonthlyDateRanges(months)

  t.ok(typeof result === 'object')
  const keys = Object.keys(result)
  t.is(keys.length, 3)

  keys.forEach(key => {
    t.ok(/^\d+-\d+$/.test(key))
    const [month, year] = key.split('-').map(Number)
    t.ok(month >= 1 && month <= 12)
    t.ok(year > 0)
  })

  Object.values(result).forEach(range => {
    t.ok('startDate' in range)
    t.ok('endDate' in range)
    t.ok(typeof range.startDate === 'number')
    t.ok(typeof range.endDate === 'number')
    t.ok(range.endDate > range.startDate)
  })
})

test('getMonthlyDateRanges: should handle zero months', (t) => {
  const result = getMonthlyDateRanges(0)
  t.is(Object.keys(result).length, 0)
})

test('isCurrentMonth: should return true for current month', (t) => {
  const now = new Date()
  const currentMonth = `${now.getMonth() + 1}-${now.getFullYear()}`
  t.ok(isCurrentMonth(currentMonth))
})

test('isCurrentMonth: should return false for different month', (t) => {
  const now = new Date()
  const differentMonth = now.getMonth() === 0 ? '12-2023' : `${now.getMonth()}-${now.getFullYear()}`
  t.not(isCurrentMonth(differentMonth))
})

test('convertMsToSeconds: should convert milliseconds to seconds', (t) => {
  t.is(convertMsToSeconds(1000), 1)
  t.is(convertMsToSeconds(5000), 5)
  t.is(convertMsToSeconds(60000), 60)
})

test('convertMsToSeconds: should floor the result', (t) => {
  t.is(convertMsToSeconds(1500), 1)
  t.is(convertMsToSeconds(1999), 1)
})

test('convertMsToSeconds: should handle zero', (t) => {
  t.is(convertMsToSeconds(0), 0)
})

test('formatDateForApi: should format date as YYYY-MM-DD', (t) => {
  const date = new Date('2024-01-15T12:00:00Z')
  const result = formatDateForApi(date)
  t.is(result, '2024-01-15')
})

test('formatDateForApi: should handle timestamp input', (t) => {
  const date = new Date('2024-06-01T12:00:00Z')
  const timestamp = date.getTime()
  const result = formatDateForApi(timestamp)
  // Result depends on local timezone, just verify format
  t.ok(/^\d{4}-\d{2}-\d{2}$/.test(result))
})

test('formatDateForApi: should pad single digit months and days', (t) => {
  // Use a date where month and day are single digits in any timezone
  const date = new Date(2024, 0, 5, 12, 0, 0) // Jan 5, 2024 noon local time
  const result = formatDateForApi(date)
  // Verify format YYYY-MM-DD with zero padding
  t.ok(/^\d{4}-\d{2}-\d{2}$/.test(result))
  t.is(result, '2024-01-05')
})

test('getTimeRanges: should return empty array when start >= end', (t) => {
  t.is(getTimeRanges(1000, 1000).length, 0)
  t.is(getTimeRanges(2000, 1000).length, 0)
})

test('getTimeRanges: should generate hourly ranges by default', (t) => {
  const start = new Date('2024-01-01T00:00:00Z').getTime()
  const end = new Date('2024-01-01T03:00:00Z').getTime()
  const result = getTimeRanges(start, end)

  t.ok(result.length > 0)
  result.forEach(range => {
    t.ok('start' in range)
    t.ok('end' in range)
    t.ok(range.end > range.start)
  })
})

test('getTimeRanges: should generate daily ranges when isHourly is false', (t) => {
  const start = new Date('2024-01-01T00:00:00Z').getTime()
  const end = new Date('2024-01-03T00:00:00Z').getTime()
  const result = getTimeRanges(start, end, false)

  t.ok(result.length > 0)
  result.forEach(range => {
    const diff = range.end - range.start
    t.ok(diff <= 24 * 60 * 60 * 1000 + 1000)
  })
})

test('transformWorkerData: should handle UNSPECIFIED status as offline', (t) => {
  const worker = {
    id: 'worker-123',
    name: 'miner1',
    status: 'UNSPECIFIED',
    hashrate: 0
  }

  const result = transformWorkerData(worker)
  t.is(result.online, 0)
})

test('extractMiningRevenue: should return 0 for undefined revenue value', (t) => {
  const revenueArray = [
    { revenue_type: 'MINING', revenue: undefined }
  ]

  const result = extractMiningRevenue(revenueArray)
  t.is(result, 0)
})

test('extractBalance: should return 0 for undefined balance value', (t) => {
  const balanceArray = [
    { currency_type: 'BTC', revenue: undefined }
  ]

  const result = extractBalance(balanceArray, 'BTC')
  t.is(result, 0)
})

test('extractHashprice: should return 0 for undefined hashprice value', (t) => {
  const hashpriceArray = [
    { currency_type: 'BTC', value: undefined }
  ]

  const result = extractHashprice(hashpriceArray, 'BTC')
  t.is(result, 0)
})

test('transformSummaryToStats: should handle missing summary fields', (t) => {
  const result = transformSummaryToStats({})

  t.is(result.hashrate, 0)
  t.is(result.hashrate_1h, 0)
  t.is(result.hashrate_24h, 0)
  t.is(result.hashrate_stale_1h, 0)
  t.is(result.hashrate_stale_24h, 0)
  t.is(result.efficiency, 0)
  t.is(result.uptime_24h, 0)
  t.is(result.active_workers_count, 0)
  t.is(result.revenue_24h, 0)
  t.is(result.revenue_all_time, 0)
  t.is(result.balance, 0)
  t.is(result.hashprice, 0)
  t.alike(result.subaccounts, [])
  t.ok(result.timestamp > 0)
})
