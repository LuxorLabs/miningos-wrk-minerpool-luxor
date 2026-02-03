'use strict'

const { setTimeout: sleep } = require('timers/promises')
const { CURRENCY, DEFAULT_PAGE_SIZE, WORKER_STATUS } = require('./constants')

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
   * @param {Object} options - Query options
   * @param {string|string[]} [options.subaccountNames] - Subaccount names to filter by
   * @param {string} [options.siteId] - Site ID to filter by
   * @returns {Promise<Object>} Summary data
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
   * @param {Object} options - Query options
   * @param {string|string[]} [options.subaccountNames] - Subaccount names to filter by
   * @param {string} [options.siteId] - Site ID to filter by
   * @param {string} [options.status] - Worker status filter (ACTIVE, INACTIVE, UNSPECIFIED)
   * @param {number} [options.pageNumber] - Page number (1-indexed)
   * @param {number} [options.pageSize] - Page size
   * @returns {Promise<Object>} Workers data with pagination
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
   * @param {Object} options - Query options
   * @returns {Promise<Object>} All workers data
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
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Active workers data
   */
  async getActiveWorkers (options = {}) {
    return this.getWorkers({ ...options, status: WORKER_STATUS.ACTIVE })
  }

  /**
   * Get transactions with pagination support
   * @param {Object} options - Query options
   * @param {string} options.startDate - Start date (YYYY-MM-DD format)
   * @param {string} options.endDate - End date (YYYY-MM-DD format)
   * @param {string|string[]} [options.subaccountNames] - Subaccount names to filter by
   * @param {string} [options.siteId] - Site ID to filter by
   * @param {string} [options.transactionType] - Transaction type filter (credit, debit)
   * @param {number} [options.pageNumber] - Page number (1-indexed)
   * @param {number} [options.pageSize] - Page size
   * @returns {Promise<Object>} Transactions data with pagination
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
   * @param {Object} options - Query options
   * @returns {Promise<Array>} All transactions
   */
  async getAllTransactions (options = {}) {
    const allTransactions = []
    let pageNumber = 1

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await this.getTransactions({ ...options, pageNumber, pageSize: this.pageSize })

      if (result.transactions && result.transactions.length > 0) {
        allTransactions.push(...result.transactions)
      }

      // Check if there are more pages
      if (!result.pagination?.next_page_url) {
        break
      }

      pageNumber++
    }

    return allTransactions
  }

  /**
   * Get pool hashrate statistics
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Pool hashrate data
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
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Pool stats data
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
   * Get hashrate efficiency data
   * @param {Object} options - Query options
   * @param {string} options.startDate - Start date (YYYY-MM-DD format)
   * @param {string} options.endDate - End date (YYYY-MM-DD format)
   * @param {string} [options.tickSize] - Tick size: 5m, 1h, 1d, 1w, 1M (default: 1d)
   * @returns {Promise<Object>} Hashrate efficiency data
   */
  async getHashrateEfficiency (options = {}) {
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

    return this._request(`/v2/pool/hashrate-efficiency/${this.currencyType}`, params)
  }

  /**
   * Get uptime statistics
   * @param {Object} options - Query options
   * @param {string} options.startDate - Start date (YYYY-MM-DD format)
   * @param {string} options.endDate - End date (YYYY-MM-DD format)
   * @param {string} [options.tickSize] - Tick size: 1d, 1w, 1M (default: 1d)
   * @returns {Promise<Object>} Uptime data
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
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Revenue data
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
   * @returns {Promise<Object>} Subaccounts data
   */
  async getSubaccounts () {
    return this._request('/v2/pool/subaccounts')
  }
}

module.exports = {
  LuxorMinerPool
}
