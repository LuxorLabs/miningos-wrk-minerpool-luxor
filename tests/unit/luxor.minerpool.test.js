'use strict'

const test = require('brittle')
const { LuxorMinerPool } = require('../../workers/lib/luxor.minerpool')
const { CURRENCY } = require('../../workers/lib/constants')

test('LuxorMinerPool: should initialize with http, apiKey and options', (t) => {
  const mockHttp = {}
  const apiKey = 'test-api-key'

  const client = new LuxorMinerPool(mockHttp, apiKey)

  t.is(client._http, mockHttp)
  t.is(client.apiKey, apiKey)
  t.is(client.currencyType, CURRENCY)
  t.is(client.pageSize, 100)
})

test('LuxorMinerPool: should accept custom options', (t) => {
  const mockHttp = {}
  const apiKey = 'test-api-key'
  const options = {
    currencyType: 'LTC_DOGE',
    pageSize: 50
  }

  const client = new LuxorMinerPool(mockHttp, apiKey, options)

  t.is(client.currencyType, 'LTC_DOGE')
  t.is(client.pageSize, 50)
})

test('LuxorMinerPool: getSummary should call _request with correct parameters', async (t) => {
  const mockHttp = {
    get: async (url, options) => {
      t.ok(url.startsWith('/v2/pool/summary/BTC'))
      t.is(options.headers.authorization, 'test-api-key')
      t.is(options.encoding, 'json')
      return {
        body: {
          hashrate_5m: '1000000000000',
          hashrate_1h: '800000000000',
          hashrate_24h: '950000000000',
          hashrate_stale_1h: '400000000000',
          hashrate_stale_24h: '300000000000',
          efficiency_5m: 0.99,
          active_miners: 100,
          balance: [{ currency_type: 'BTC', revenue: 0.5 }]
        }
      }
    }
  }

  const client = new LuxorMinerPool(mockHttp, 'test-api-key')
  const result = await client.getSummary()

  t.ok(result)
  t.is(result.hashrate_5m, '1000000000000')
  t.is(result.active_miners, 100)
})

test('LuxorMinerPool: getSummary should include subaccount filter', async (t) => {
  const mockHttp = {
    get: async (url) => {
      t.ok(url.includes('subaccount_names=sub1%2Csub2'))
      return {
        body: {}
      }
    }
  }

  const client = new LuxorMinerPool(mockHttp, 'test-api-key')
  await client.getSummary({ subaccountNames: ['sub1', 'sub2'] })
})

test('LuxorMinerPool: getWorkers should call _request with correct parameters', async (t) => {
  const mockHttp = {
    get: async (url, options) => {
      t.ok(url.startsWith('/v2/pool/workers/BTC'))
      t.ok(url.includes('page_number=1'))
      t.ok(url.includes('page_size=100'))
      t.is(options.headers.authorization, 'test-api-key')
      return {
        body: {
          workers: [
            {
              id: 'worker-1',
              name: 'miner1',
              status: 'ACTIVE',
              hashrate: 100000000000
            }
          ],
          total_active: 1,
          total_inactive: 0,
          pagination: {
            page_number: 1,
            page_size: 100,
            next_page_url: null
          }
        }
      }
    }
  }

  const client = new LuxorMinerPool(mockHttp, 'test-api-key')
  const result = await client.getWorkers()

  t.ok(result)
  t.ok(Array.isArray(result.workers))
  t.is(result.workers.length, 1)
  t.is(result.workers[0].name, 'miner1')
})

test('LuxorMinerPool: getWorkers should include status filter', async (t) => {
  const mockHttp = {
    get: async (url) => {
      t.ok(url.includes('status=ACTIVE'))
      return {
        body: { workers: [], pagination: {} }
      }
    }
  }

  const client = new LuxorMinerPool(mockHttp, 'test-api-key')
  await client.getWorkers({ status: 'ACTIVE' })
})

test('LuxorMinerPool: getAllWorkers should paginate through all results', async (t) => {
  let callCount = 0
  const mockHttp = {
    get: async (url) => {
      callCount++
      if (callCount === 1) {
        return {
          body: {
            workers: [{ id: 'w1' }, { id: 'w2' }],
            total_active: 3,
            total_inactive: 0,
            subaccounts: [{ name: 'sub1' }],
            pagination: {
              page_number: 1,
              next_page_url: '/next'
            }
          }
        }
      }
      return {
        body: {
          workers: [{ id: 'w3' }],
          pagination: {
            page_number: 2,
            next_page_url: null
          }
        }
      }
    }
  }

  const client = new LuxorMinerPool(mockHttp, 'test-api-key')
  const result = await client.getAllWorkers()

  t.is(callCount, 2)
  t.is(result.workers.length, 3)
  t.is(result.total_active, 3)
  t.is(result.subaccounts.length, 1)
})

test('LuxorMinerPool: getTransactions should require date range', async (t) => {
  const mockHttp = {}
  const client = new LuxorMinerPool(mockHttp, 'test-api-key')

  try {
    await client.getTransactions({})
    t.fail('Should have thrown an error')
  } catch (e) {
    t.is(e.message, 'ERR_DATE_RANGE_REQUIRED')
  }
})

test('LuxorMinerPool: getTransactions should call _request with correct parameters', async (t) => {
  const mockHttp = {
    get: async (url, options) => {
      t.ok(url.startsWith('/v2/pool/transactions/BTC'))
      t.ok(url.includes('start_date=2024-01-01'))
      t.ok(url.includes('end_date=2024-01-31'))
      t.is(options.headers.authorization, 'test-api-key')
      return {
        body: {
          transactions: [
            { transaction_id: 'tx1', currency_amount: 0.001 }
          ],
          pagination: { next_page_url: null }
        }
      }
    }
  }

  const client = new LuxorMinerPool(mockHttp, 'test-api-key')
  const result = await client.getTransactions({
    startDate: '2024-01-01',
    endDate: '2024-01-31'
  })

  t.ok(result)
  t.ok(Array.isArray(result.transactions))
  t.is(result.transactions.length, 1)
})

test('LuxorMinerPool: _request should include timeout', async (t) => {
  const mockHttp = {
    get: async (url, options) => {
      t.is(options.timeout, 30 * 1000)
      return { body: {} }
    }
  }

  const client = new LuxorMinerPool(mockHttp, 'test-api-key')
  await client.getSummary()
})

test('LuxorMinerPool: _request should handle errors', async (t) => {
  const mockHttp = {
    get: async () => {
      throw new Error('API Error')
    }
  }

  const client = new LuxorMinerPool(mockHttp, 'test-api-key')

  try {
    await client.getSummary()
    t.fail('Should have thrown an error')
  } catch (e) {
    t.ok(e instanceof Error)
    t.is(e.message, 'API Error')
  }
})

test('LuxorMinerPool: getPoolHashrate should call correct endpoint', async (t) => {
  const mockHttp = {
    get: async (url) => {
      t.ok(url.startsWith('/v2/pool/pool-hashrate/BTC'))
      return { body: {} }
    }
  }

  const client = new LuxorMinerPool(mockHttp, 'test-api-key')
  await client.getPoolHashrate()
})

test('LuxorMinerPool: getUptime should call correct endpoint', async (t) => {
  const mockHttp = {
    get: async (url) => {
      t.ok(url.startsWith('/v2/pool/uptime/BTC'))
      t.ok(url.includes('start_date='))
      t.ok(url.includes('end_date='))
      t.ok(url.includes('tick_size='))
      return { body: {} }
    }
  }

  const client = new LuxorMinerPool(mockHttp, 'test-api-key')
  await client.getUptime({
    startDate: '2024-01-01',
    endDate: '2024-01-07',
    tickSize: '1d'
  })
})

test('LuxorMinerPool: getUptime should require date range', async (t) => {
  const mockHttp = {}
  const client = new LuxorMinerPool(mockHttp, 'test-api-key')

  try {
    await client.getUptime({})
    t.fail('Should have thrown an error')
  } catch (e) {
    t.is(e.message, 'ERR_DATE_RANGE_REQUIRED')
  }
})

test('LuxorMinerPool: getRevenue should call correct endpoint', async (t) => {
  const mockHttp = {
    get: async (url) => {
      t.ok(url.startsWith('/v2/pool/revenue/BTC'))
      return { body: {} }
    }
  }

  const client = new LuxorMinerPool(mockHttp, 'test-api-key')
  await client.getRevenue()
})

test('LuxorMinerPool: getSubaccounts should call correct endpoint', async (t) => {
  const mockHttp = {
    get: async (url) => {
      t.is(url, '/v2/pool/subaccounts')
      return { body: {} }
    }
  }

  const client = new LuxorMinerPool(mockHttp, 'test-api-key')
  await client.getSubaccounts()
})

test('LuxorMinerPool: getPoolStats should call correct endpoint', async (t) => {
  const mockHttp = {
    get: async (url) => {
      t.ok(url.startsWith('/v2/pool/pool-stats/BTC'))
      t.ok(url.includes('subaccount_names=sub1'))
      t.ok(url.includes('site_id=site-1'))
      return { body: { pool_hashrate: '500000000000' } }
    }
  }

  const client = new LuxorMinerPool(mockHttp, 'test-api-key')
  const result = await client.getPoolStats({ subaccountNames: ['sub1'], siteId: 'site-1' })
  t.ok(result)
  t.is(result.pool_hashrate, '500000000000')
})

test('LuxorMinerPool: getActiveWorkers should filter by ACTIVE status', async (t) => {
  const mockHttp = {
    get: async (url) => {
      t.ok(url.includes('status=ACTIVE'))
      return { body: { workers: [{ id: 'w1', status: 'ACTIVE' }], pagination: {} } }
    }
  }

  const client = new LuxorMinerPool(mockHttp, 'test-api-key')
  const result = await client.getActiveWorkers()
  t.ok(result)
  t.is(result.workers.length, 1)
  t.is(result.workers[0].status, 'ACTIVE')
})

test('LuxorMinerPool: getRevenue should include subaccount and site filters', async (t) => {
  const mockHttp = {
    get: async (url) => {
      t.ok(url.startsWith('/v2/pool/revenue/BTC'))
      t.ok(url.includes('subaccount_names=sub1%2Csub2'))
      t.ok(url.includes('site_id=site-1'))
      return { body: { revenue: 0.5 } }
    }
  }

  const client = new LuxorMinerPool(mockHttp, 'test-api-key')
  const result = await client.getRevenue({ subaccountNames: ['sub1', 'sub2'], siteId: 'site-1' })
  t.ok(result)
  t.is(result.revenue, 0.5)
})

test('LuxorMinerPool: getAllTransactions should paginate through all results', async (t) => {
  let callCount = 0
  const mockHttp = {
    get: async (url) => {
      callCount++
      if (callCount === 1) {
        return {
          body: {
            transactions: [{ transaction_id: 'tx1' }, { transaction_id: 'tx2' }],
            pagination: { next_page_url: '/next' }
          }
        }
      }
      return {
        body: {
          transactions: [{ transaction_id: 'tx3' }],
          pagination: { next_page_url: null }
        }
      }
    }
  }

  const client = new LuxorMinerPool(mockHttp, 'test-api-key')
  const result = await client.getAllTransactions({
    startDate: '2024-01-01',
    endDate: '2024-01-31'
  })

  t.is(callCount, 2)
  t.is(result.length, 3)
  t.is(result[0].transaction_id, 'tx1')
  t.is(result[2].transaction_id, 'tx3')
})
