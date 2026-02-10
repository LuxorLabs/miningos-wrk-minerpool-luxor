'use strict'

const { setTimeout: sleep } = require('timers/promises')
const { CURRENCY, DEFAULT_PAGE_SIZE, WORKER_STATUS } = require('./constants')

/**
 * @typedef {Object} QueryOptions
 * @property {string|string[]} [subaccountNames] - Subaccount names to filter by
 * @property {string} [siteId] - Site ID to filter by
 */

/**
 * @typedef {Object} PaginatedOptions
 * @property {number} [pageNumber] - Page number (1-indexed)
 * @property {number} [pageSize] - Items per page
 */

/**
 * @typedef {Object} DateRangeOptions
 * @property {string} startDate - Start date (YYYY-MM-DD)
 * @property {string} endDate - End date (YYYY-MM-DD)
 */

/**
 * @typedef {Object} PaginationInfo
 * @property {number} page_number
 * @property {number} page_size
 * @property {number} item_count
 * @property {string|null} previous_page_url
 * @property {string|null} next_page_url
 */

/**
 * @typedef {Object} Site
 * @property {string} id - UUID
 * @property {string} name
 */

/**
 * @typedef {Object} Subaccount
 * @property {number} id
 * @property {string} name
 * @property {Site} site
 * @property {string} created_at - ISO 8601 timestamp
 * @property {string} url
 */

/**
 * @typedef {Object} RevenueEntry
 * @property {string} currency_type
 * @property {number} revenue
 * @property {string} revenue_type - e.g. 'MINING'
 */

/**
 * @typedef {Object} BalanceEntry
 * @property {string} currency_type
 * @property {number} revenue
 */

/**
 * @typedef {Object} HashpriceEntry
 * @property {string} currency_type
 * @property {number} value
 */

/**
 * @typedef {Object} UptimeEntry
 * @property {string} date_time - ISO 8601 timestamp
 * @property {number} uptime
 */

/**
 * @typedef {Object} RevenueHistoryEntry
 * @property {string} date_time - ISO 8601 timestamp
 * @property {RevenueEntry} revenue
 */

/**
 * @typedef {Object} Transaction
 * @property {string} currency_type
 * @property {string} date_time - ISO 8601 timestamp
 * @property {string} address_name - Wallet identifier
 * @property {string} subaccount_name
 * @property {string} transaction_category - e.g. "Miner Revenue"
 * @property {number} currency_amount - Amount in cryptocurrency
 * @property {number} usd_equivalent - USD value
 * @property {string} transaction_id - Unique ID
 * @property {string} transaction_type - 'credit' or 'debit'
 */

/**
 * @typedef {Object} WorkersResult
 * @property {string} currency_type
 * @property {Subaccount[]} subaccounts
 * @property {number} total_active
 * @property {number} total_inactive
 * @property {LuxorWorker[]} workers
 * @property {PaginationInfo} pagination
 */

/**
 * @typedef {Object} LuxorSummary
 * @property {string} currency_type
 * @property {Subaccount[]} subaccounts
 * @property {string} hashrate_5m
 * @property {string} hashrate_1h
 * @property {string} hashrate_24h
 * @property {string} hashrate_stale_1h
 * @property {string} hashrate_stale_24h
 * @property {number} efficiency_5m - 0.0-1.0
 * @property {number} uptime_24h - 0.0-1.0
 * @property {number} active_miners
 * @property {RevenueEntry[]} revenue_24h
 * @property {RevenueEntry[]} revenue_all_time
 * @property {BalanceEntry[]} balance
 * @property {HashpriceEntry[]} hashprice
 */

/**
 * @typedef {Object} LuxorWorker
 * @property {string} currency_type
 * @property {string} id
 * @property {string} subaccount_name
 * @property {string} name
 * @property {string} firmware
 * @property {number} hashrate
 * @property {number} efficiency
 * @property {number} stale_shares
 * @property {number} rejected_shares
 * @property {string} last_share_time - ISO 8601 timestamp
 * @property {string} status - 'ACTIVE' | 'INACTIVE' | 'UNSPECIFIED'
 */

/**
 * @typedef {Object} LuxorPoolHashrate
 * @property {string} currency_type
 * @property {string} hashrate_5m
 * @property {string} hashrate_1h
 * @property {string} hashrate_24h
 */

/**
 * @typedef {Object} LuxorPoolStats
 * @property {string} currency_type
 * @property {string} hashrate_5m
 * @property {string} hashrate_1h
 * @property {string} hashrate_24h
 * @property {string} active_workers_5m
 * @property {string} hashprice
 * @property {string} minimum_payment_threshold
 */

/**
 * @typedef {Object} LuxorUptime
 * @property {string} currency_type
 * @property {string} start_date
 * @property {string} end_date
 * @property {string} tick_size
 * @property {Subaccount[]} subaccounts
 * @property {UptimeEntry[]} uptime
 * @property {PaginationInfo} pagination
 */

/**
 * @typedef {Object} LuxorRevenue
 * @property {string} currency_type
 * @property {string} start_date
 * @property {string} end_date
 * @property {Subaccount[]} subaccounts
 * @property {RevenueHistoryEntry[]} revenue
 */

/**
 * @typedef {Object} LuxorSubaccounts
 * @property {Subaccount[]} subaccounts
 * @property {PaginationInfo} pagination
 */

/**
 * Luxor Mining Pool API Client
 * @see https://app.luxor.tech/api
 */
class LuxorMinerPool {
  constructor (http, apiKey, options = {}) {
    this._http = http
    this.apiKey = apiKey
    this.currencyType = options.currencyType || CURRENCY
    this.pageSize = options.pageSize || DEFAULT_PAGE_SIZE
  }

  /**
   * Make a GET request to the Luxor API
   * @param {string} apiPath - API endpoint path
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} API response
   */
  async _request (apiPath, params = {}) {
    // Rate limiting - wait between calls
    await sleep(1000)

    const queryParams = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        queryParams.append(key, value)
      }
    }

    const queryString = queryParams.toString()
    const url = queryString ? `${apiPath}?${queryString}` : apiPath

    const { body: resp } = await this._http.get(url, {
      headers: { authorization: this.apiKey },
      encoding: 'json',
      timeout: 30 * 1000
    })

    return resp
  }

  /**
   * Get summary statistics for the workspace
   * @param {QueryOptions} [options] - Query options
   * @returns {Promise<LuxorSummary>} Summary data
   */
  async getSummary (options = {}) {
    const params = {}
    if (options.subaccountNames) {
      params.subaccount_names = Array.isArray(options.subaccountNames)
        ? options.subaccountNames.join(',')
        : options.subaccountNames
    }
    if (options.siteId) {
      params.site_id = options.siteId
    }

    return this._request(`/v2/pool/summary/${this.currencyType}`, params)
  }

  /**
   * Get workers list with pagination support
   * @param {QueryOptions & PaginatedOptions & {status?: string}} [options] - Query options
   * @returns {Promise<WorkersResult>} Workers data with pagination
   */
  async getWorkers (options = {}) {
    const params = {
      page_number: options.pageNumber || 1,
      page_size: options.pageSize || this.pageSize
    }

    if (options.subaccountNames) {
      params.subaccount_names = Array.isArray(options.subaccountNames)
        ? options.subaccountNames.join(',')
        : options.subaccountNames
    }
    if (options.siteId) {
      params.site_id = options.siteId
    }
    if (options.status) {
      params.status = options.status
    }

    return this._request(`/v2/pool/workers/${this.currencyType}`, params)
  }

  /**
   * Get all workers by iterating through pages
   * @param {QueryOptions} [options] - Query options
   * @returns {Promise<WorkersResult>} All workers data
   */
  async getAllWorkers (options = {}) {
    const allWorkers = []
    let pageNumber = 1
    let totalActive = 0
    let totalInactive = 0
    let subaccounts = []

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await this.getWorkers({ ...options, pageNumber, pageSize: this.pageSize })

      if (pageNumber === 1) {
        totalActive = result.total_active || 0
        totalInactive = result.total_inactive || 0
        subaccounts = result.subaccounts || []
      }

      if (result.workers && result.workers.length > 0) {
        allWorkers.push(...result.workers)
      }

      // Check if there are more pages
      if (!result.pagination?.next_page_url) {
        break
      }

      pageNumber++
    }

    return {
      currency_type: this.currencyType,
      subaccounts,
      total_active: totalActive,
      total_inactive: totalInactive,
      workers: allWorkers
    }
  }

  /**
   * Get active workers only
   * @param {QueryOptions} [options] - Query options
   * @returns {Promise<WorkersResult>} Active workers data
   */
  async getActiveWorkers (options = {}) {
    return this.getWorkers({ ...options, status: WORKER_STATUS.ACTIVE })
  }

  /**
   * Get transactions with pagination support
   * @param {DateRangeOptions & QueryOptions & PaginatedOptions & {transactionType?: string}} options - Query options
   * @returns {Promise<{transactions: Transaction[], pagination: PaginationInfo}>} Transactions data with pagination
   */
  async getTransactions (options = {}) {
    if (!options.startDate || !options.endDate) {
      throw new Error('ERR_DATE_RANGE_REQUIRED')
    }

    const params = {
      start_date: options.startDate,
      end_date: options.endDate,
      page_number: options.pageNumber || 1,
      page_size: options.pageSize || this.pageSize
    }

    if (options.subaccountNames) {
      params.subaccount_names = Array.isArray(options.subaccountNames)
        ? options.subaccountNames.join(',')
        : options.subaccountNames
    }
    if (options.siteId) {
      params.site_id = options.siteId
    }
    if (options.transactionType) {
      params.transaction_type = options.transactionType
    }

    return this._request(`/v2/pool/transactions/${this.currencyType}`, params)
  }

  /**
   * Get all transactions by iterating through pages
   * @param {DateRangeOptions & QueryOptions & {transactionType?: string}} options - Query options
   * @returns {Promise<Transaction[]>} All transactions
   */
  async getAllTransactions (options = {}) {
    const allTransactions = []
    let pageNumber = 1

    let nextPageUrl = null
    do {
      const result = await this.getTransactions({ ...options, pageNumber, pageSize: this.pageSize })

      if (result.transactions && result.transactions.length > 0) {
        allTransactions.push(...result.transactions)
      }

      nextPageUrl = result.pagination?.next_page_url
      pageNumber++
    } while (nextPageUrl !== null)

    return allTransactions
  }

  /**
   * Get pool hashrate statistics
   * @param {QueryOptions} [options] - Query options
   * @returns {Promise<LuxorPoolHashrate>} Pool hashrate data
   */
  async getPoolHashrate (options = {}) {
    const params = {}
    if (options.subaccountNames) {
      params.subaccount_names = Array.isArray(options.subaccountNames)
        ? options.subaccountNames.join(',')
        : options.subaccountNames
    }
    if (options.siteId) {
      params.site_id = options.siteId
    }

    return this._request(`/v2/pool/pool-hashrate/${this.currencyType}`, params)
  }

  /**
   * Get pool statistics
   * @param {QueryOptions} [options] - Query options
   * @returns {Promise<LuxorPoolStats>} Pool stats data
   */
  async getPoolStats (options = {}) {
    const params = {}
    if (options.subaccountNames) {
      params.subaccount_names = Array.isArray(options.subaccountNames)
        ? options.subaccountNames.join(',')
        : options.subaccountNames
    }
    if (options.siteId) {
      params.site_id = options.siteId
    }

    return this._request(`/v2/pool/pool-stats/${this.currencyType}`, params)
  }

  /**
   * Get uptime statistics
   * @param {DateRangeOptions & QueryOptions & {tickSize?: string}} options - Query options
   * @returns {Promise<LuxorUptime>} Uptime data
   */
  async getUptime (options = {}) {
    if (!options.startDate || !options.endDate) {
      throw new Error('ERR_DATE_RANGE_REQUIRED')
    }

    const params = {
      start_date: options.startDate,
      end_date: options.endDate,
      tick_size: options.tickSize || '1d'
    }

    if (options.subaccountNames) {
      params.subaccount_names = Array.isArray(options.subaccountNames)
        ? options.subaccountNames.join(',')
        : options.subaccountNames
    }
    if (options.siteId) {
      params.site_id = options.siteId
    }

    return this._request(`/v2/pool/uptime/${this.currencyType}`, params)
  }

  /**
   * Get revenue statistics
   * @param {QueryOptions} [options] - Query options
   * @returns {Promise<LuxorRevenue>} Revenue data
   */
  async getRevenue (options = {}) {
    const params = {}
    if (options.subaccountNames) {
      params.subaccount_names = Array.isArray(options.subaccountNames)
        ? options.subaccountNames.join(',')
        : options.subaccountNames
    }
    if (options.siteId) {
      params.site_id = options.siteId
    }

    return this._request(`/v2/pool/revenue/${this.currencyType}`, params)
  }

  /**
   * Get subaccounts list
   * @returns {Promise<LuxorSubaccounts>} Subaccounts data
   */
  async getSubaccounts () {
    return this._request('/v2/pool/subaccounts')
  }
}

module.exports = {
  LuxorMinerPool
}
