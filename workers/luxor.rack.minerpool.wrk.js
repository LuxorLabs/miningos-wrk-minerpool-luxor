'use strict'

const { LuxorMinerPool } = require('./lib/luxor.minerpool')
const { POOL_TYPE, MINUTE_MS, HOUR_MS, HOURS_24_MS, SCHEDULER_TIMES } = require('./lib/constants')
const async = require('async')
const TetherWrkBase = require('tether-wrk-base/workers/base.wrk.tether')
const { getWorkersStats, getTimeRanges, isCurrentMonth, getMonthlyDateRanges, formatDateForApi } = require('./lib/utils')
const utilsStore = require('hp-svc-facs-store/utils')
const gLibUtilBase = require('lib-js-util-base')
const mingo = require('mingo')

class WrkMinerPoolRackLuxor extends TetherWrkBase {
  constructor (conf, ctx) {
    super(conf, ctx)

    if (!ctx.rack) {
      throw new Error('ERR_PROC_RACK_UNDEFINED')
    }

    this.prefix = `${this.wtype}-${ctx.rack}`
    this.init()
    this.start()

    this.data = {
      statsData: {},
      workersData: { ts: 0, workers: [] },
      yearlyBalances: {}
    }
  }

  init () {
    super.init()

    this.loadConf('luxor', 'luxor')
    this.apiKey = this.conf.luxor.apiKey
    this.currencyType = this.conf.luxor.currencyType || 'BTC'
    this.subaccountNames = this.conf.luxor.subaccountNames || []
    this.siteId = this.conf.luxor.siteId || null
    this.pageSize = this.conf.luxor.pageSize || 100

    // Luxor API requires either subaccountNames or siteId
    if (this.subaccountNames.length === 0 && !this.siteId) {
      console.warn('WARNING: Luxor API requires subaccountNames or siteId. Some endpoints may fail.')
    }

    this.setInitFacs([
      ['fac', 'bfx-facs-scheduler', '0', 'luxor', {}, -10],
      ['fac', 'hp-svc-facs-store', 's1', 's1', {
        storePrimaryKey: this.ctx.storePrimaryKey,
        storeDir: `store/${this.ctx.rack}-db`
      }, 0],
      ['fac', 'bfx-facs-http', '0', '0', {
        baseUrl: this.conf.luxor.apiUrl,
        timeout: 30 * 1000
      }, 0]
    ])
  }

  _start (cb) {
    async.series([
      (next) => { super._start(next) },
      async () => {
        this.net_r0.rpcServer.respond('getWrkExtData', async (req) => {
          return await this.net_r0.handleReply('getWrkExtData', req)
        })

        const db = await this.store_s1.getBee(
          { name: 'luxor' },
          { keyEncoding: 'binary' }
        )
        await db.ready()
        this.transactionsDb = db.sub('transactions')
        this.workersCountDb = db.sub('workers-count')
        this.statsDb = db.sub('stats')
        this.workersDb = db.sub('workers')

        this.luxorApi = new LuxorMinerPool(this.http_0, this.apiKey, {
          currencyType: this.currencyType,
          pageSize: this.pageSize
        })

        for (const { time, key } of Object.values(SCHEDULER_TIMES)) {
          this.scheduler_luxor.add(key, (fireTime) => {
            this.fetchData(key, fireTime)
          }, time)
        }
      }
    ], cb)
  }

  async fetchData (key, time) {
    try {
      switch (key) {
        case SCHEDULER_TIMES._1M.key:
          await this.fetchStats(time)
          break
        case SCHEDULER_TIMES._5M.key:
          await this.fetchWorkers(time)
          await this.saveStats(time)
          break
        case SCHEDULER_TIMES._1D.key:
          await this.fetchTransactions()
          await this.saveWorkers(time)
          break
      }
    } catch (e) {
      this._logErr('ERR_DATA_FETCH', e)
    }
  }

  async _saveToDb (db, ts, data) {
    await db.put(utilsStore.convIntToBin(ts), Buffer.from(JSON.stringify(data)))
  }

  _logErr (msg, err) {
    console.error(new Date().toISOString(), msg, err)
  }

  _getQueryOptions () {
    const options = {}
    if (this.subaccountNames && this.subaccountNames.length > 0) {
      options.subaccountNames = this.subaccountNames
    }
    if (this.siteId) {
      options.siteId = this.siteId
    }
    return options
  }

  async fetchStats (time) {
    const queryOptions = this._getQueryOptions()

    try {
      const summary = await this.luxorApi.getSummary(queryOptions)

      // Parse hashrate strings to numbers
      const hashrate5m = parseFloat(summary.hashrate_5m) || 0
      const hashrate24h = parseFloat(summary.hashrate_24h) || 0

      // Extract mining revenue from revenue arrays
      const revenue24h = this._extractMiningRevenue(summary.revenue_24h)
      const revenueAllTime = this._extractMiningRevenue(summary.revenue_all_time)

      // Extract balance
      const balance = this._extractBalance(summary.balance)

      // Extract hashprice
      const hashprice = this._extractHashprice(summary.hashprice)

      // Get yearly balances
      const yearlyBalances = await this.getYearlyBalances()

      const stats = [{
        username: this.subaccountNames.length > 0 ? this.subaccountNames.join(',') : 'workspace',
        timestamp: Date.now(),
        balance,
        revenue_24h: revenue24h,
        revenue_all_time: revenueAllTime,
        hashrate: hashrate5m,
        hashrate_24h: hashrate24h,
        efficiency: summary.efficiency_5m || 0,
        uptime_24h: summary.uptime_24h || 0,
        active_workers_count: summary.active_miners || 0,
        worker_count: this.data.workersData.workers.length,
        hashprice,
        yearlyBalances,
        subaccounts: summary.subaccounts || []
      }]

      this.data.statsData = { ts: Math.floor(time.getTime() / 1000) * 1000, stats }
    } catch (e) {
      this._logErr('ERR_STATS_FETCH', e)
    }
  }

  _extractMiningRevenue (revenueArray) {
    if (!Array.isArray(revenueArray)) return 0
    const miningRevenue = revenueArray.find(r => r.revenue_type === 'MINING')
    return miningRevenue?.revenue || 0
  }

  _extractBalance (balanceArray) {
    if (!Array.isArray(balanceArray)) return 0
    const balance = balanceArray.find(b => b.currency_type === this.currencyType)
    return balance?.revenue || 0
  }

  _extractHashprice (hashpriceArray) {
    if (!Array.isArray(hashpriceArray)) return 0
    const hashprice = hashpriceArray.find(h => h.currency_type === this.currencyType)
    return hashprice?.value || 0
  }

  async saveStats (time) {
    const ts = Math.floor(time.getTime() / 1000) * 1000
    await this._saveToDb(this.statsDb, ts, { ts, stats: this.data.statsData.stats })
  }

  async saveWorkers (time) {
    const ts = Math.floor(time.getTime() / 1000) * 1000
    await this._saveToDb(this.workersDb, ts, { ts, workers: this.data.workersData.workers })
  }

  async fetchWorkers (time) {
    const queryOptions = this._getQueryOptions()

    try {
      const result = await this.luxorApi.getAllWorkers(queryOptions)
      const workers = getWorkersStats(result.workers || [])

      const ts = Math.floor(time.getTime() / 1000) * 1000
      this.data.workersData = { ts, workers }
      await this._saveToDb(this.workersCountDb, ts, {
        ts,
        count: workers.length,
        active: result.total_active || 0,
        inactive: result.total_inactive || 0
      })
    } catch (e) {
      this._logErr('ERR_WORKERS_FETCH', e)
    }
  }

  async fetchTransactions () {
    const queryOptions = this._getQueryOptions()

    try {
      const today = new Date()
      const startDate = formatDateForApi(new Date(today.setHours(0, 0, 0, 0)))
      const endDate = formatDateForApi(Date.now())

      const transactions = await this.luxorApi.getAllTransactions({
        ...queryOptions,
        startDate,
        endDate
      })

      const startTime = new Date().setHours(0, 0, 0, 0)
      await this._saveToDb(this.transactionsDb, startTime, { ts: startTime, transactions })
    } catch (e) {
      this._logErr('ERR_TRANSACTIONS_FETCH', e)
    }
  }

  async getYearlyBalances () {
    const queryOptions = this._getQueryOptions()
    const yearlyDateRanges = getMonthlyDateRanges(12)
    const balances = this.data.yearlyBalances

    for (const [month, { startDate, endDate }] of Object.entries(yearlyDateRanges)) {
      if (!balances[month] || isCurrentMonth(month)) {
        try {
          const transactions = await this.luxorApi.getAllTransactions({
            ...queryOptions,
            startDate: formatDateForApi(startDate),
            endDate: formatDateForApi(endDate),
            transactionType: 'credit' // Only credits (incoming)
          })

          balances[month] = transactions.reduce((bal, t) => bal + (t.currency_amount || 0), 0)
        } catch (e) {
          this._logErr('ERR_BALANCES_FETCH', e)
          balances[month] = 0
        }
      }
    }

    this.data.yearlyBalances = balances
    return Object.entries(balances).map(([month, balance]) => ({ month, balance }))
  }

  _aggrTransactions (data, { start, end }) {
    // Aggregate hourly revenue
    const totalRevenue = data.reduce((total, log) => {
      log.transactions?.forEach((transaction) => {
        total += transaction.currency_amount || 0
      })
      return total
    }, 0)

    const tsRange = getTimeRanges(start, end)
    const hourlyRevenues = []
    if (!tsRange.length) return { ts: Date.now(), hourlyRevenues }

    const hourlyAvgRevenue = totalRevenue / tsRange.length
    tsRange.forEach(({ end }) => {
      hourlyRevenues.push({ ts: end, revenue: hourlyAvgRevenue })
    })

    return { ts: Date.now(), hourlyRevenues }
  }

  _getIntervalMs (interval) {
    switch (interval) {
      case '1D':
        return HOURS_24_MS
      case '3h':
        return 3 * HOUR_MS
      case '30m':
        return 30 * MINUTE_MS
      case '5m':
      default:
        return 5 * MINUTE_MS
    }
  }

  _avg (avg, value, count) {
    return (avg * (count - 1) + value) / count
  }

  _aggrByInterval (data, interval) {
    const intervalMs = this._getIntervalMs(interval)
    const aggrBuckets = {}

    // Bucket data points by interval
    data.forEach(d => {
      const aggrTimestamp = Math.ceil(d.ts / intervalMs) * intervalMs
      if (!aggrBuckets[aggrTimestamp]) {
        aggrBuckets[aggrTimestamp] = []
      }
      aggrBuckets[aggrTimestamp].push(d)
    })

    // For each bucket, calculate average of hashrate
    return Object.entries(aggrBuckets).map(([ts, items]) => {
      return items.reduce((acc, d, itemIndex) => {
        d.stats = d.stats.map((stat, statsIndex) => {
          const avgHashrate = acc?.stats?.[statsIndex]?.hashrate || 0
          const hashrate = this._avg(avgHashrate, stat.hashrate, itemIndex + 1)
          return { ...stat, hashrate }
        })
        return { ...acc, ...d, ts: Number(ts) }
      }, {})
    })
  }

  async getDbData (db, { start, end }) {
    if (!start) throw new Error('ERR_START_INVALID')
    if (!end) throw new Error('ERR_END_INVALID')

    const query = {
      gte: utilsStore.convIntToBin(start),
      lte: utilsStore.convIntToBin(end)
    }

    const stream = db.createReadStream(query)
    const res = []
    for await (const entry of stream) {
      res.push(JSON.parse(entry.value.toString()))
    }

    return res
  }

  _projection (data, fields = {}) {
    const query = new mingo.Query({})
    if (Array.isArray(data)) return query.find(data, fields).all()
    const cursor = query.find([data], fields)
    return cursor.all()[0]
  }

  filterWorkers (workers, offset, limit) {
    return workers.slice(offset, offset + (Math.min(limit, 100)))
  }

  async getWorkers (query) {
    const { offset = 0, limit = 100, name, start, end } = query
    if (!start || !end) {
      const workersObj = { ts: 0, workers: this.filterWorkers(this.data.workersData.workers, offset, limit) }
      workersObj.workers = this.appendPoolType(workersObj.workers)
      return workersObj
    }
    const data = await this.getDbData(this.workersDb, query)
    return data.reduce((aggr, obj) => {
      let workersObj
      if (name) workersObj = { ts: obj.ts, workers: obj.workers.filter(w => w.name === name) }
      else workersObj = { ts: obj.ts, workers: this.filterWorkers(obj.workers, offset, limit) }
      workersObj.workers = this.appendPoolType(workersObj.workers)
      aggr = aggr.concat(workersObj)
      return aggr
    }, [])
  }

  appendPoolType (data) {
    return data.map(d => ({ poolType: POOL_TYPE, ...d }))
  }

  async getWrkExtData (req) {
    const { query } = req
    if (!query) throw new Error('ERR_QUERY_INVALID')

    const { key } = query
    if (!key) throw new Error('ERR_KEY_INVALID')

    let data
    switch (key) {
      case 'transactions':
        data = await this.getDbData(this.transactionsDb, query)
        if (query.aggrHourly) data = this._aggrTransactions(data, query)
        break
      case 'workers-count':
        data = await this.getDbData(this.workersCountDb, query)
        break
      case 'workers':
        data = this.getWorkers(query)
        break
      case 'stats':
        data = this.data.statsData
        if (data.stats) data.stats = this.appendPoolType(data.stats)
        break
      case 'stats-history':
        data = await this.getDbData(this.statsDb, query)
        if (query.interval) data = this._aggrByInterval(data, query.interval)
        data.forEach(d => { if (d.stats) d.stats = this.appendPoolType(d.stats) })
        break
      default:
        data = this.data[key]
        break
    }

    if (!gLibUtilBase.isEmpty(query.fields)) return this._projection(data, query.fields)
    return data
  }
}

module.exports = WrkMinerPoolRackLuxor
