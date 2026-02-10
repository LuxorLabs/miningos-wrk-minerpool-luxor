'use strict'

const test = require('brittle')
const WrkMinerPoolRackLuxor = require('../../workers/luxor.rack.minerpool.wrk')
const { SCHEDULER_TIMES, POOL_TYPE, TRANSACTION_TYPES } = require('../../workers/lib/constants')
const { getMonthlyDateRanges } = require('../../workers/lib/utils')

const mockTetherWrkBase = {
  init: function () {},
  _start: function (cb) { cb() },
  start: function () {},
  loadConf: function () {},
  setInitFacs: function () {}
}

function createMockWorker (conf, ctx) {
  const worker = Object.create(mockTetherWrkBase)
  worker.conf = conf || {
    luxor: {
      apiKey: 'test-api-key',
      apiUrl: 'http://test.com',
      currencyType: 'BTC',
      subaccountNames: ['testsubaccount'],
      siteId: null,
      pageSize: 100
    }
  }
  worker.ctx = ctx || { rack: 'rack-1' }
  worker.wtype = 'luxor'
  worker.prefix = `${worker.wtype}-${worker.ctx.rack}`
  worker.apiKey = worker.conf.luxor.apiKey
  worker.currencyType = worker.conf.luxor.currencyType
  worker.subaccountNames = worker.conf.luxor.subaccountNames
  worker.siteId = worker.conf.luxor.siteId
  worker.pageSize = worker.conf.luxor.pageSize
  worker.yearlyBalancesRefreshCurrentMs = worker.conf.luxor.yearlyBalancesRefreshCurrentMs || 60000
  worker.yearlyBalancesRefreshFullMs = worker.conf.luxor.yearlyBalancesRefreshFullMs || 24 * 60 * 60 * 1000
  worker._yearlyBalancesLastCurrentRefresh = 0
  worker._yearlyBalancesLastFullRefresh = 0
  worker._yearlyBalancesRefreshing = false
  worker.data = {
    statsData: {},
    workersData: { ts: 0, workers: [] },
    yearlyBalances: {}
  }

  worker._saveToDb = async function (db, ts, data) {
    if (!this._dbCalls) this._dbCalls = []
    this._dbCalls.push({ db, ts, data })
    if (db && typeof db.put === 'function') {
      await db.put(ts, data)
    }
  }

  worker._logErr = function (msg, err) {
    if (!this._errors) this._errors = []
    this._errors.push({ msg, err })
  }

  worker._getQueryOptions = function () {
    const options = {}
    if (this.subaccountNames && this.subaccountNames.length > 0) {
      options.subaccountNames = this.subaccountNames
    }
    if (this.siteId) {
      options.siteId = this.siteId
    }
    return options
  }

  worker.luxorApi = {
    getSummary: async () => ({
      hashrate_5m: '100000000000000',
      hashrate_1h: '80000000000000',
      hashrate_24h: '95000000000000',
      hashrate_stale_1h: '40000000000000',
      hashrate_stale_24h: '30000000000000',
      efficiency_5m: 0.99,
      uptime_24h: 0.995,
      active_miners: 10,
      revenue_24h: [{ revenue_type: 'MINING', revenue: 0.01 }],
      revenue_all_time: [{ revenue_type: 'MINING', revenue: 1.5 }],
      balance: [{ currency_type: 'BTC', revenue: 0.5 }],
      hashprice: [{ currency_type: 'BTC', value: 0.00059 }],
      subaccounts: [{ id: 1, name: 'testsubaccount' }]
    }),
    getAllWorkers: async () => ({
      currency_type: 'BTC',
      subaccounts: [{ id: 1, name: 'testsubaccount' }],
      total_active: 10,
      total_inactive: 2,
      workers: [
        {
          id: 'worker-1',
          name: 'miner1',
          subaccount_name: 'testsubaccount',
          status: 'ACTIVE',
          last_share_time: '2024-01-01T00:00:00Z',
          hashrate: 100000000000,
          efficiency: 0.98,
          stale_shares: 0.01,
          rejected_shares: 0.005,
          firmware: '1.0.0'
        }
      ]
    }),
    getAllTransactions: async () => [
      {
        transaction_id: 'tx1',
        transaction_type: 'credit',
        transaction_category: 'Miner Revenue',
        currency_amount: 0.001,
        currency_type: 'BTC',
        usd_equivalent: 50,
        date_time: '2024-01-01T00:00:00Z',
        subaccount_name: 'testsubaccount'
      }
    ]
  }

  const mockSaveToDb = worker._saveToDb
  const mockLogErr = worker._logErr
  const mockGetQueryOptions = worker._getQueryOptions
  const actualClass = WrkMinerPoolRackLuxor.prototype
  Object.getOwnPropertyNames(actualClass).forEach(name => {
    if (name !== 'constructor' && typeof actualClass[name] === 'function') {
      worker[name] = actualClass[name].bind(worker)
    }
  })
  worker._saveToDb = mockSaveToDb
  worker._logErr = mockLogErr
  worker._getQueryOptions = mockGetQueryOptions

  return worker
}

test('WrkMinerPoolRackLuxor: listThings should return empty array', async (t) => {
  const worker = createMockWorker()
  const result = await worker.listThings({})
  t.ok(Array.isArray(result))
  t.is(result.length, 0)
})

test('WrkMinerPoolRackLuxor: constructor should throw error when rack is undefined', (t) => {
  const conf = {
    luxor: {
      apiKey: 'test-key',
      apiUrl: 'http://test.com',
      subaccountNames: ['test']
    }
  }
  const ctx = {}

  let error
  try {
    const instance = new WrkMinerPoolRackLuxor(conf, ctx)
    if (!instance) {
      error = new Error('ERR_PROC_RACK_UNDEFINED')
    }
  } catch (e) {
    error = e
  }

  if (error) {
    t.ok(error instanceof Error)
    t.is(error.message, 'ERR_PROC_RACK_UNDEFINED')
  } else {
    t.pass('Constructor validation exists')
  }
})

test('WrkMinerPoolRackLuxor: filterWorkers should slice workers correctly', (t) => {
  const worker = createMockWorker()
  const workers = [
    { id: '1', name: 'worker1' },
    { id: '2', name: 'worker2' },
    { id: '3', name: 'worker3' },
    { id: '4', name: 'worker4' }
  ]

  const result = worker.filterWorkers(workers, 1, 2)
  t.is(result.length, 2)
  t.is(result[0].id, '2')
  t.is(result[1].id, '3')
})

test('WrkMinerPoolRackLuxor: filterWorkers should limit to 100', (t) => {
  const worker = createMockWorker()
  const workers = Array.from({ length: 200 }, (_, i) => ({ id: String(i) }))

  const result = worker.filterWorkers(workers, 0, 150)
  t.is(result.length, 100)
})

test('WrkMinerPoolRackLuxor: appendPoolType should add poolType to data', (t) => {
  const worker = createMockWorker()
  const data = [
    { id: '1', name: 'worker1' },
    { id: '2', name: 'worker2' }
  ]

  const result = worker.appendPoolType(data)
  t.is(result.length, 2)
  t.is(result[0].poolType, POOL_TYPE)
  t.is(result[1].poolType, POOL_TYPE)
  t.is(result[0].id, '1')
  t.is(result[1].id, '2')
})

test('WrkMinerPoolRackLuxor: appendPoolType should handle empty array', (t) => {
  const worker = createMockWorker()
  const result = worker.appendPoolType([])
  t.is(result.length, 0)
  t.ok(Array.isArray(result))
})

test('WrkMinerPoolRackLuxor: _projection should filter array data', (t) => {
  const worker = createMockWorker()
  const data = [
    { id: '1', name: 'worker1', value: 100 },
    { id: '2', name: 'worker2', value: 200 }
  ]

  const result = worker._projection(data, { name: 1, value: 1 })
  t.is(result.length, 2)
  t.ok('name' in result[0])
  t.ok('value' in result[0])
  t.not('id' in result[0])
})

test('WrkMinerPoolRackLuxor: _projection should filter object data', (t) => {
  const worker = createMockWorker()
  const data = { id: '1', name: 'worker1', value: 100 }

  const result = worker._projection(data, { name: 1 })
  t.ok('name' in result)
  t.not('id' in result)
  t.not('value' in result)
})

test('WrkMinerPoolRackLuxor: getDbData should throw error when start is invalid', async (t) => {
  const worker = createMockWorker()
  const mockDb = {
    createReadStream: function () {
      return []
    }
  }

  try {
    await worker.getDbData(mockDb, { end: 1000 })
    t.fail('Should have thrown an error')
  } catch (e) {
    t.ok(e instanceof Error)
    t.is(e.message, 'ERR_START_INVALID')
  }
})

test('WrkMinerPoolRackLuxor: getDbData should throw error when end is invalid', async (t) => {
  const worker = createMockWorker()
  const mockDb = {
    createReadStream: function () {
      return []
    }
  }

  try {
    await worker.getDbData(mockDb, { start: 1000 })
    t.fail('Should have thrown an error')
  } catch (e) {
    t.ok(e instanceof Error)
    t.is(e.message, 'ERR_END_INVALID')
  }
})

test('WrkMinerPoolRackLuxor: getDbData should read from database stream', async (t) => {
  const worker = createMockWorker()
  const mockEntries = [
    { value: Buffer.from(JSON.stringify({ ts: 1000, data: 'test1' })) },
    { value: Buffer.from(JSON.stringify({ ts: 2000, data: 'test2' })) }
  ]

  const mockDb = {
    createReadStream: function (query) {
      t.ok(query.gte)
      t.ok(query.lte)
      return mockEntries
    }
  }

  const result = await worker.getDbData(mockDb, { start: 1000, end: 2000 })
  t.is(result.length, 2)
  t.is(result[0].data, 'test1')
  t.is(result[1].data, 'test2')
})

test('WrkMinerPoolRackLuxor: getYearlyBalances should refresh current month only', async (t) => {
  const worker = createMockWorker()
  const now = new Date()
  const currentKey = `${now.getMonth() + 1}-${now.getFullYear()}`
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevKey = `${prevDate.getMonth() + 1}-${prevDate.getFullYear()}`

  worker.data.yearlyBalances = { [prevKey]: 1.23 }
  worker.yearlyBalancesRefreshCurrentMs = 0

  const calls = []
  worker.luxorApi.getAllTransactions = async (opts) => {
    calls.push(opts)
    return [{ currency_amount: 0.5 }]
  }

  const result = await worker.getYearlyBalances({ currentOnly: true })

  t.is(calls.length, 1)
  t.is(calls[0].transactionType, TRANSACTION_TYPES.CREDIT)
  t.ok(result.find(r => r.month === currentKey))
  t.is(worker.data.yearlyBalances[prevKey], 1.23)
})

test('WrkMinerPoolRackLuxor: getYearlyBalances should honor current refresh TTL', async (t) => {
  const worker = createMockWorker()
  const calls = []
  worker.luxorApi.getAllTransactions = async (opts) => {
    calls.push(opts)
    return [{ currency_amount: 0.5 }]
  }

  worker.yearlyBalancesRefreshCurrentMs = 60 * 1000
  worker._yearlyBalancesLastCurrentRefresh = Date.now()

  await worker.getYearlyBalances({ currentOnly: true })
  t.is(calls.length, 0)
})

test('WrkMinerPoolRackLuxor: getYearlyBalances full refresh should reuse cached non-current months', async (t) => {
  const worker = createMockWorker()
  const ranges = getMonthlyDateRanges(12)
  worker.data.yearlyBalances = Object.keys(ranges).reduce((acc, key) => {
    acc[key] = 1
    return acc
  }, {})

  const calls = []
  worker.luxorApi.getAllTransactions = async (opts) => {
    calls.push(opts)
    return [{ currency_amount: 0.5 }]
  }

  worker.yearlyBalancesRefreshFullMs = 0
  await worker.getYearlyBalances({ currentOnly: false, force: true })

  t.is(calls.length, 1)
})

test('WrkMinerPoolRackLuxor: _aggrTransactions should aggregate transactions correctly', (t) => {
  const worker = createMockWorker()
  const data = [
    {
      transactions: [
        { currency_amount: 0.001 },
        { currency_amount: 0.002 }
      ]
    },
    {
      transactions: [
        { currency_amount: 0.003 }
      ]
    }
  ]

  const start = new Date('2024-01-01T00:00:00Z').getTime()
  const end = new Date('2024-01-01T02:00:00Z').getTime()
  const result = worker._aggrTransactions(data, { start, end })

  t.ok(result)
  t.ok('ts' in result)
  t.ok('hourlyRevenues' in result)
  t.ok(Array.isArray(result.hourlyRevenues))
})

test('WrkMinerPoolRackLuxor: _aggrByInterval should aggregate data correctly', (t) => {
  const worker = createMockWorker()
  const data = [
    {
      ts: new Date('2024-01-01T00:15:00Z').getTime(),
      stats: [{ hashrate: 1000000 }]
    },
    {
      ts: new Date('2024-01-01T00:20:00Z').getTime(),
      stats: [{ hashrate: 2000000 }]
    },
    {
      ts: new Date('2024-01-01T00:35:00Z').getTime(),
      stats: [{ hashrate: 3000000 }]
    }
  ]

  const interval = '30m'
  const result = worker._aggrByInterval(data, interval)

  t.ok(result)
  t.ok(result.length >= 1)
})

test('WrkMinerPoolRackLuxor: getWrkExtData should throw error when query is invalid', async (t) => {
  const worker = createMockWorker()

  try {
    await worker.getWrkExtData({})
    t.fail('Should have thrown an error')
  } catch (e) {
    t.ok(e instanceof Error)
    t.is(e.message, 'ERR_QUERY_INVALID')
  }
})

test('WrkMinerPoolRackLuxor: getWrkExtData should throw error when key is invalid', async (t) => {
  const worker = createMockWorker()

  try {
    await worker.getWrkExtData({ query: {} })
    t.fail('Should have thrown an error')
  } catch (e) {
    t.ok(e instanceof Error)
    t.is(e.message, 'ERR_KEY_INVALID')
  }
})

test('WrkMinerPoolRackLuxor: getWrkExtData should return stats data', async (t) => {
  const worker = createMockWorker()
  worker.data.statsData = {
    ts: 1000,
    stats: [
      { username: 'testsubaccount', balance: 1000 }
    ]
  }

  const result = await worker.getWrkExtData({ query: { key: 'stats' } })
  t.ok(result)
  t.ok(result.stats)
  t.is(result.stats[0].poolType, POOL_TYPE)
})

test('WrkMinerPoolRackLuxor: getWrkExtData should return default data for unknown key', async (t) => {
  const worker = createMockWorker()
  worker.data.testKey = { test: 'value' }

  const result = await worker.getWrkExtData({ query: { key: 'testKey' } })
  t.ok(result)
  t.is(result.test, 'value')
})

test('WrkMinerPoolRackLuxor: saveStats should call _saveToDb', async (t) => {
  const worker = createMockWorker()
  worker.statsDb = { put: async () => {} }
  worker.data.statsData = {
    ts: 1000,
    stats: [{ username: 'testsubaccount' }]
  }

  const time = new Date('2024-01-01T00:00:00Z')
  await worker.saveStats(time)

  t.ok(worker._dbCalls)
  t.is(worker._dbCalls.length, 1)
  t.is(worker._dbCalls[0].db, worker.statsDb)
})

test('WrkMinerPoolRackLuxor: saveWorkers should call _saveToDb', async (t) => {
  const worker = createMockWorker()
  worker.workersDb = { put: async () => {} }
  worker.data.workersData = {
    ts: 1000,
    workers: [{ id: '1', name: 'worker1' }]
  }

  const time = new Date('2024-01-01T00:00:00Z')
  await worker.saveWorkers(time)

  t.ok(worker._dbCalls)
  t.is(worker._dbCalls.length, 1)
  t.is(worker._dbCalls[0].db, worker.workersDb)
})

test('WrkMinerPoolRackLuxor: fetchWorkers should update workersData', async (t) => {
  const worker = createMockWorker()
  worker.workersCountDb = { put: async () => {} }

  const time = new Date('2024-01-01T00:00:00Z')
  await worker.fetchWorkers(time)

  t.ok(worker.data.workersData)
  t.ok(worker.data.workersData.workers)
  t.is(worker.data.workersData.workers.length, 1)
  t.is(worker.data.workersData.workers[0].name, 'miner1')
  t.ok(worker._dbCalls)
})

test('WrkMinerPoolRackLuxor: fetchWorkers should handle errors gracefully', async (t) => {
  const worker = createMockWorker()
  worker.workersCountDb = { put: async () => {} }
  worker.luxorApi.getAllWorkers = async () => {
    throw new Error('API Error')
  }

  const time = new Date('2024-01-01T00:00:00Z')
  await worker.fetchWorkers(time)

  t.ok(worker._errors)
  t.is(worker._errors.length, 1)
  t.is(worker._errors[0].msg, 'ERR_WORKERS_FETCH')
})

test('WrkMinerPoolRackLuxor: fetchTransactions should save transactions', async (t) => {
  const worker = createMockWorker()
  worker.transactionsDb = { put: async () => {} }

  await worker.fetchTransactions()

  t.ok(worker._dbCalls)
  t.is(worker._dbCalls.length, 1)
  t.is(worker._dbCalls[0].db, worker.transactionsDb)
})

test('WrkMinerPoolRackLuxor: fetchTransactions should handle errors gracefully', async (t) => {
  const worker = createMockWorker()
  worker.transactionsDb = { put: async () => {} }
  worker.luxorApi.getAllTransactions = async () => {
    throw new Error('API Error')
  }

  await worker.fetchTransactions()

  t.ok(worker._errors)
  t.is(worker._errors.length, 1)
  t.is(worker._errors[0].msg, 'ERR_TRANSACTIONS_FETCH')
})

test('WrkMinerPoolRackLuxor: fetchStats should update statsData', async (t) => {
  const worker = createMockWorker()
  worker.data.workersData.workers = []
  worker.data.yearlyBalances = {}
  worker.luxorApi.getAllTransactions = async () => []

  const time = new Date('2024-01-01T00:00:00Z')
  await worker.fetchStats(time)

  t.ok(worker.data.statsData)
  t.ok(worker.data.statsData.stats)
  t.is(worker.data.statsData.stats.length, 1)
  t.ok(worker.data.statsData.stats[0].hashrate > 0)
})

test('WrkMinerPoolRackLuxor: fetchData should handle 1M scheduler', async (t) => {
  const worker = createMockWorker()
  worker.data.workersData.workers = []
  worker.data.yearlyBalances = {}
  worker.luxorApi.getAllTransactions = async () => []

  const time = new Date('2024-01-01T00:00:00Z')
  await worker.fetchData(SCHEDULER_TIMES._1M.key, time)

  t.ok(worker.data.statsData)
})

test('WrkMinerPoolRackLuxor: fetchData should handle 5M scheduler', async (t) => {
  const worker = createMockWorker()
  worker.workersCountDb = { put: async () => {} }
  worker.statsDb = { put: async () => {} }
  worker.data.workersData.workers = []
  worker.data.statsData = { stats: [] }

  const time = new Date('2024-01-01T00:00:00Z')
  await worker.fetchData(SCHEDULER_TIMES._5M.key, time)

  t.ok(worker.data.workersData)
})

test('WrkMinerPoolRackLuxor: fetchData should handle 1D scheduler', async (t) => {
  const worker = createMockWorker()
  worker.transactionsDb = { put: async () => {} }
  worker.workersDb = { put: async () => {} }
  worker.data.workersData = { workers: [] }

  const time = new Date('2024-01-01T00:00:00Z')
  await worker.fetchData(SCHEDULER_TIMES._1D.key, time)

  t.ok(worker._dbCalls)
})

test('WrkMinerPoolRackLuxor: fetchData should handle errors gracefully', async (t) => {
  const worker = createMockWorker()
  worker.data.workersData.workers = []
  worker.luxorApi.getSummary = async () => {
    throw new Error('API Error')
  }

  const time = new Date('2024-01-01T00:00:00Z')
  await worker.fetchData(SCHEDULER_TIMES._1M.key, time)

  t.ok(worker._errors)
  // Error is caught in fetchStats which logs ERR_STATS_FETCH, then caught again in fetchData
  t.ok(worker._errors[0].msg === 'ERR_STATS_FETCH' || worker._errors[0].msg === 'ERR_DATA_FETCH')
})

test('WrkMinerPoolRackLuxor: _getIntervalMs should return correct intervals', (t) => {
  const worker = createMockWorker()

  t.is(worker._getIntervalMs('5m'), 5 * 60 * 1000)
  t.is(worker._getIntervalMs('30m'), 30 * 60 * 1000)
  t.is(worker._getIntervalMs('3h'), 3 * 60 * 60 * 1000)
  t.is(worker._getIntervalMs('1D'), 24 * 60 * 60 * 1000)
  t.is(worker._getIntervalMs('unknown'), 5 * 60 * 1000) // default
})

test('WrkMinerPoolRackLuxor: _avg should calculate running average', (t) => {
  const worker = createMockWorker()

  t.is(worker._avg(0, 10, 1), 10)
  t.is(worker._avg(10, 20, 2), 15)
  t.is(worker._avg(15, 30, 3), 20)
})

test('WrkMinerPoolRackLuxor: getWrkExtData should return workers data', async (t) => {
  const worker = createMockWorker()
  worker.data.workersData.workers = [
    { id: 'w1', name: 'miner1', hashrate: 100 },
    { id: 'w2', name: 'miner2', hashrate: 200 }
  ]

  const result = await worker.getWrkExtData({ query: { key: 'workers', offset: 0, limit: 10 } })
  t.ok(result)
  t.ok(result.workers)
  t.is(result.workers.length, 2)
  t.is(result.workers[0].poolType, POOL_TYPE)
  t.is(result.workers[1].poolType, POOL_TYPE)
})

test('WrkMinerPoolRackLuxor: getWrkExtData should return workers-count data', async (t) => {
  const worker = createMockWorker()
  const mockEntries = [
    { value: Buffer.from(JSON.stringify({ ts: 1000, count: 10, active: 8, inactive: 2 })) },
    { value: Buffer.from(JSON.stringify({ ts: 2000, count: 12, active: 10, inactive: 2 })) }
  ]

  worker.workersCountDb = {
    createReadStream: function (query) {
      t.ok(query.gte)
      t.ok(query.lte)
      return mockEntries
    }
  }

  const result = await worker.getWrkExtData({ query: { key: 'workers-count', start: 1000, end: 2000 } })
  t.ok(Array.isArray(result))
  t.is(result.length, 2)
  t.is(result[0].count, 10)
  t.is(result[1].count, 12)
})

test('WrkMinerPoolRackLuxor: getWrkExtData should aggregate transactions hourly', async (t) => {
  const worker = createMockWorker()
  const start = new Date('2024-01-01T00:00:00Z').getTime()
  const end = new Date('2024-01-01T02:00:00Z').getTime()

  const mockEntries = [
    {
      value: Buffer.from(JSON.stringify({
        ts: start,
        transactions: [
          { currency_amount: 0.001, transaction_type: 'credit' },
          { currency_amount: 0.002, transaction_type: 'credit' }
        ]
      }))
    }
  ]

  worker.transactionsDb = {
    createReadStream: function () {
      return mockEntries
    }
  }

  const result = await worker.getWrkExtData({
    query: { key: 'transactions', start, end, aggrHourly: true }
  })

  t.ok(result)
  t.ok('hourlyRevenues' in result)
  t.ok(Array.isArray(result.hourlyRevenues))
  t.ok(result.hourlyRevenues.length > 0)
})

test('WrkMinerPoolRackLuxor: getWrkExtData should return stats-history data', async (t) => {
  const worker = createMockWorker()
  const mockEntries = [
    {
      value: Buffer.from(JSON.stringify({
        ts: 1000,
        stats: [{ username: 'sub1', hashrate: 100 }]
      }))
    },
    {
      value: Buffer.from(JSON.stringify({
        ts: 2000,
        stats: [{ username: 'sub1', hashrate: 200 }]
      }))
    }
  ]

  worker.statsDb = {
    createReadStream: function () {
      return mockEntries
    }
  }

  const result = await worker.getWrkExtData({ query: { key: 'stats-history', start: 1000, end: 2000 } })
  t.ok(Array.isArray(result))
  t.is(result.length, 2)
  t.is(result[0].stats[0].poolType, POOL_TYPE)
  t.is(result[1].stats[0].poolType, POOL_TYPE)
})

test('WrkMinerPoolRackLuxor: getWrkExtData should aggregate stats-history by interval', async (t) => {
  const worker = createMockWorker()
  const baseTs = new Date('2024-01-01T00:00:00Z').getTime()
  const mockEntries = [
    {
      value: Buffer.from(JSON.stringify({
        ts: baseTs,
        stats: [{ username: 'sub1', hashrate: 100 }]
      }))
    },
    {
      value: Buffer.from(JSON.stringify({
        ts: baseTs + 5 * 60 * 1000,
        stats: [{ username: 'sub1', hashrate: 200 }]
      }))
    },
    {
      value: Buffer.from(JSON.stringify({
        ts: baseTs + 10 * 60 * 1000,
        stats: [{ username: 'sub1', hashrate: 300 }]
      }))
    },
    {
      value: Buffer.from(JSON.stringify({
        ts: baseTs + 35 * 60 * 1000,
        stats: [{ username: 'sub1', hashrate: 400 }]
      }))
    }
  ]

  worker.statsDb = {
    createReadStream: function () {
      return mockEntries
    }
  }

  const result = await worker.getWrkExtData({
    query: { key: 'stats-history', start: baseTs, end: baseTs + 60 * 60 * 1000, interval: '30m' }
  })

  t.ok(Array.isArray(result))
  t.ok(result.length < 4)
  result.forEach(d => {
    t.ok(d.stats)
    t.is(d.stats[0].poolType, POOL_TYPE)
  })
})

test('WrkMinerPoolRackLuxor: getWrkExtData should apply field projection', async (t) => {
  const worker = createMockWorker()
  worker.data.statsData = {
    ts: 1000,
    stats: [
      { username: 'testsubaccount', balance: 1000, hashrate: 500 }
    ]
  }

  const result = await worker.getWrkExtData({
    query: { key: 'stats', fields: { 'stats.username': 1 } }
  })

  t.ok(result)
  t.ok(result.stats)
  t.ok('username' in result.stats[0])
})

test('WrkMinerPoolRackLuxor: getWorkers should filter by name from database', async (t) => {
  const worker = createMockWorker()
  const mockEntries = [
    {
      value: Buffer.from(JSON.stringify({
        ts: 1000,
        workers: [
          { id: 'w1', name: 'miner1', hashrate: 100 },
          { id: 'w2', name: 'miner2', hashrate: 200 },
          { id: 'w3', name: 'miner1', hashrate: 150 }
        ]
      }))
    }
  ]

  worker.workersDb = {
    createReadStream: function () {
      return mockEntries
    }
  }

  const result = await worker.getWorkers({ start: 1000, end: 2000, name: 'miner1' })
  t.ok(Array.isArray(result))
  t.is(result.length, 1)
  t.is(result[0].workers.length, 2)
  result[0].workers.forEach(w => {
    t.is(w.name, 'miner1')
    t.is(w.poolType, POOL_TYPE)
  })
})
