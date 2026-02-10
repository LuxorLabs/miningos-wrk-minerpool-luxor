'use strict'

const { LuxorMinerPool } = require('./lib/luxor.minerpool')
const { POOL_TYPE, MINUTE_MS, HOUR_MS, HOURS_24_MS, SCHEDULER_TIMES, TRANSACTION_TYPES } = require('./lib/constants')
const async = require('async')
const TetherWrkBase = require('tether-wrk-base/workers/base.wrk.tether')
const { transformSummaryToStats, getWorkersStats, getTimeRanges, isCurrentMonth, getMonthlyDateRanges, formatDateForApi } = require('./lib/utils')
const utilsStore = require('hp-svc-facs-store/utils')
const gLibUtilBase = require('lib-js-util-base')
const mingo = require('mingo')

/**
 * @typedef {Object} YearlyBalance
 * @property {string} month - Month in "M-YYYY" format
 * @property {number} balance - Total balance for the month
 */

/**
 * @typedef {Object} StatsEntry
 * @property {string} username
 * @property {number} timestamp
 * @property {number} balance
 * @property {number} unsettled
 * @property {number} revenue_24h
 * @property {number} estimated_today_income
 * @property {number} hashrate
 * @property {number} hashrate_1h
 * @property {number} hashrate_24h
 * @property {number} hashrate_stale_1h
 * @property {number} hashrate_stale_24h
 * @property {number} worker_count
 * @property {number} active_workers_count
 * @property {Array<YearlyBalance>} yearlyBalances
 * @property {number} efficiency
 * @property {number} uptime_24h
 * @property {number} hashprice
 * @property {Array} subaccounts
 * @property {number} revenue_all_time
 */

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

  /** @returns {void} */
  init () {
    super.init()

    this.loadConf('luxor', 'luxor')
    this.apiKey = this.conf.luxor.apiKey
    this.currencyType = this.conf.luxor.currencyType || 'BTC'
    this.subaccountNames = this.conf.luxor.subaccountNames || []
    this.siteId = this.conf.luxor.siteId || null
    this.pageSize = this.conf.luxor.pageSize || 100
    this.yearlyBalancesRefreshCurrentMs = this.conf.luxor.yearlyBalancesRefreshCurrentMs || MINUTE_MS
    this.yearlyBalancesRefreshFullMs = this.conf.luxor.yearlyBalancesRefreshFullMs || HOURS_24_MS
    this._yearlyBalancesLastCurrentRefresh = 0
    this._yearlyBalancesLastFullRefresh = 0
    this._yearlyBalancesRefreshing = false

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

  /**
   * @param {Function} cb
   * @returns {void}
   */
  _start (cb) {
    async.series([
      (next) => { super._start(next) },
      async () => {
        this.net_r0.rpcServer.respond('getWrkExtData', async (req) => {
          return await this.net_r0.handleReply('getWrkExtData', req)
        })

        // Ork shows a log error if this method is not registered
        this.net_r0.rpcServer.respond('listThings', async (req) => {
          return await this.net_r0.handleReply('listThings', req)
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

  /**
   * @param {string} key
   * @param {Date} time
   * @returns {Promise<void>}
   */
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
          await this.getYearlyBalances({ currentOnly: false, force: true })
          break
      }
    } catch (e) {
      this._logErr('ERR_DATA_FETCH', e)
    }
  }

  /**
   * @param {Object} db
   * @param {number} ts
   * @param {Object} data
   * @returns {Promise<void>}
   */
  async _saveToDb (db, ts, data) {
    await db.put(utilsStore.convIntToBin(ts), Buffer.from(JSON.stringify(data)))
  }

  /**
   * @param {string} msg
   * @param {Error} err
   * @returns {void}
   */
  _logErr (msg, err) {
    console.error(new Date().toISOString(), msg, err)
  }

  /** @returns {QueryOptions} */
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

  /**
   * @param {Date} time
   * @returns {Promise<void>}
   */
  async fetchStats (time) {
    const queryOptions = this._getQueryOptions()

    try {
      const rawSummary = await this.luxorApi.getSummary(queryOptions)

      const summary = transformSummaryToStats(rawSummary)

      // Refresh current month yearly balances with caching (parity with F2Pool)
      const yearlyBalances = await this.getYearlyBalances({ currentOnly: true })

      const stats = [{
        username: this.subaccountNames.length > 0 ? this.subaccountNames.join(',') : 'workspace',
        timestamp: Date.now(),
        balance: summary.balance,
        unsettled: 0,
        revenue_24h: summary.revenue_24h,
        estimated_today_income: summary.revenue_24h,
        hashrate: summary.hashrate,
        hashrate_1h: summary.hashrate_1h,
        hashrate_24h: summary.hashrate_24h,
        hashrate_stale_1h: summary.hashrate_stale_1h,
        hashrate_stale_24h: summary.hashrate_stale_24h,
        worker_count: this.data.workersData.workers.length,
        active_workers_count: summary.active_workers_count || 0,
        yearlyBalances,
        // Extra fields
        efficiency: summary.efficiency || 0,
        uptime_24h: summary.uptime_24h || 0,
        hashprice: summary.hashprice,
        subaccounts: summary.subaccounts || [],
        revenue_all_time: summary.revenue_all_time
      }]

      this.data.statsData = { ts: Math.floor(time.getTime() / 1000) * 1000, stats }
    } catch (e) {
      this._logErr('ERR_STATS_FETCH', e)
    }
  }

  /**
   * @param {Date} time
   * @returns {Promise<void>}
   */
  async saveStats (time) {
    const ts = Math.floor(time.getTime() / 1000) * 1000
    await this._saveToDb(this.statsDb, ts, { ts, stats: this.data.statsData.stats })
  }

  /**
   * @param {Date} time
   * @returns {Promise<void>}
   */
  async saveWorkers (time) {
    const ts = Math.floor(time.getTime() / 1000) * 1000
    await this._saveToDb(this.workersDb, ts, { ts, workers: this.data.workersData.workers })
  }

  /**
   * @param {Date} time
   * @returns {Promise<void>}
   */
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

  /** @returns {Promise<void>} */
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

  /** @returns {YearlyBalance[]} */
  _getYearlyBalancesSnapshot () {
    return Object.entries(this.data.yearlyBalances || {}).map(([month, balance]) => ({ month, balance }))
  }

  /**
   * @param {Object} [options]
   * @param {boolean} [options.currentOnly]
   * @param {boolean} [options.force]
   * @returns {Promise<YearlyBalance[]>}
   */
  async getYearlyBalances ({ currentOnly = false, force = false } = {}) {
    if (this._yearlyBalancesRefreshing) {
      return this._getYearlyBalancesSnapshot()
    }

    const now = Date.now()
    if (!force) {
      if (currentOnly && now - this._yearlyBalancesLastCurrentRefresh < this.yearlyBalancesRefreshCurrentMs) {
        return this._getYearlyBalancesSnapshot()
      }
      if (!currentOnly && now - this._yearlyBalancesLastFullRefresh < this.yearlyBalancesRefreshFullMs) {
        return this._getYearlyBalancesSnapshot()
      }
    }

    this._yearlyBalancesRefreshing = true
    const queryOptions = this._getQueryOptions()
    const yearlyDateRanges = getMonthlyDateRanges(12)
    const balances = this.data.yearlyBalances

    try {
      for (const [month, { startDate, endDate }] of Object.entries(yearlyDateRanges)) {
        const isCurrent = isCurrentMonth(month)
        if (currentOnly && !isCurrent) continue
        if (!currentOnly && balances[month] && !isCurrent) continue

        // The end_date never must be bigger than today, otherwise the API will return an error
        // For example today is 2026-02-08 and `isCurrent` is true, the endDate is 2026-03-01, so must be converted to 2026-02-08 (today)
        const maxSafeEndDate = isCurrent ? Date.now() : endDate

        try {
          const transactions = await this.luxorApi.getAllTransactions({
            ...queryOptions,
            startDate: formatDateForApi(startDate),
            endDate: formatDateForApi(maxSafeEndDate),
            transactionType: TRANSACTION_TYPES.CREDIT // Only credits (incoming)
          })

          balances[month] = transactions.reduce((bal, t) => bal + (t.currency_amount || 0), 0)
        } catch (e) {
          this._logErr('ERR_BALANCES_FETCH', e)
          if (!balances[month]) balances[month] = 0
        }
      }

      this.data.yearlyBalances = balances
      if (currentOnly) this._yearlyBalancesLastCurrentRefresh = now
      else this._yearlyBalancesLastFullRefresh = now
    } finally {
      this._yearlyBalancesRefreshing = false
    }

    return this._getYearlyBalancesSnapshot()
  }

  /**
   * @param {Array<{transactions: Transaction[]}>} data
   * @param {{start: number, end: number}} options
   * @returns {{ts: number, hourlyRevenues: Array<{ts: number, revenue: number}>}}
   */
  _aggrTransactions (data, { start, end }) {
    // Aggregate hourly revenue (credits add, debits subtract)
    const totalRevenue = data.reduce((total, log) => {
      log.transactions?.forEach((transaction) => {
        const amount = transaction.currency_amount || 0
        if (transaction.transaction_type === TRANSACTION_TYPES.DEBIT) {
          total -= amount
        } else {
          total += amount
        }
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

  /**
   * @param {string} interval
   * @returns {number}
   */
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

  /**
   * @param {number} avg
   * @param {number} value
   * @param {number} count
   * @returns {number}
   */
  _avg (avg, value, count) {
    return (avg * (count - 1) + value) / count
  }

  /**
   * @param {Array<{ts: number, stats: Array}>} data
   * @param {string} interval
   * @returns {Array<{ts: number, stats: Array}>}
   */
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

  /**
   * @param {Object} db
   * @param {{start: number, end: number}} options
   * @returns {Promise<Array>}
   */
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

  /**
   * @param {Array|Object} data
   * @param {Object} [fields]
   * @returns {Array|Object}
   */
  _projection (data, fields = {}) {
    const query = new mingo.Query({})
    if (Array.isArray(data)) return query.find(data, fields).all()
    const cursor = query.find([data], fields)
    return cursor.all()[0]
  }

  /**
   * @param {WorkerStats[]} workers
   * @param {number} offset
   * @param {number} limit
   * @returns {WorkerStats[]}
   */
  filterWorkers (workers, offset, limit) {
    return workers.slice(offset, offset + (Math.min(limit, 100)))
  }

  /**
   * @param {{offset?: number, limit?: number, name?: string, start?: number, end?: number}} query
   * @returns {Promise<Object|Array>}
   */
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

  /**
   * @param {Array<Object>} data
   * @returns {Array<Object>}
   */
  appendPoolType (data) {
    return data.map(d => ({ poolType: POOL_TYPE, ...d }))
  }

  /**
   * @param {Object} req
   * @returns {Promise<Array>}
   */
  async listThings (req) {
    return []
  }

  /**
   * @param {{query: {key: string, start?: number, end?: number, aggrHourly?: boolean, interval?: string, fields?: Object}}} req
   * @returns {Promise<Object>}
   */
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
