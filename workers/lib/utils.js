'use strict'

const { HOUR_MS, HOURS_24_MS, WORKER_STATUS } = require('./constants')

/** @typedef {import('./luxor.minerpool').LuxorWorker} LuxorWorker */
/** @typedef {import('./luxor.minerpool').LuxorSummary} LuxorSummary */
/** @typedef {import('./luxor.minerpool').RevenueEntry} RevenueEntry */
/** @typedef {import('./luxor.minerpool').BalanceEntry} BalanceEntry */
/** @typedef {import('./luxor.minerpool').HashpriceEntry} HashpriceEntry */

/**
 * @typedef {Object} WorkerStats
 * @property {string} id
 * @property {string} name
 * @property {string} username
 * @property {number} online - 1 if active, 0 if inactive
 * @property {string} last_updated
 * @property {number} hashrate
 * @property {number} hashrate_1h
 * @property {number} hashrate_24h
 * @property {number} hashrate_stale_1h
 * @property {number} hashrate_stale_24h
 * @property {number} stale_shares
 * @property {number} rejected_shares
 * @property {string} firmware
 */

/**
 * @typedef {Object} PoolStats
 * @property {number} timestamp
 * @property {number} hashrate
 * @property {number} hashrate_1h
 * @property {number} hashrate_24h
 * @property {number} hashrate_stale_1h
 * @property {number} hashrate_stale_24h
 * @property {number} efficiency
 * @property {number} uptime_24h
 * @property {number} active_workers_count
 * @property {number} revenue_24h
 * @property {number} revenue_all_time
 * @property {number} balance
 * @property {number} hashprice
 * @property {Array} subaccounts
 */

/**
 * @typedef {Object} MonthlyDateRange
 * @property {number} startDate - Start of month in milliseconds
 * @property {number} endDate - Start of next month in milliseconds
 */

/**
 * @typedef {Object} TimeRange
 * @property {number} start - Start timestamp in milliseconds
 * @property {number} end - End timestamp in milliseconds
 */

/**
 * Transform Luxor worker data to MiningOS standard format
 * @param {LuxorWorker} worker - Luxor worker object
 * @returns {WorkerStats} Normalized worker stats
 */
function transformWorkerData (worker) {
  return {
    id: worker.id,
    name: worker.name,
    username: worker.subaccount_name,
    online: worker.status === WORKER_STATUS.ACTIVE ? 1 : 0,
    last_updated: worker.last_share_time,
    hashrate: worker.hashrate || 0,
    hashrate_1h: 0,
    hashrate_24h: 0,
    hashrate_stale_1h: 0,
    hashrate_stale_24h: 0,
    // Extra fields
    stale_shares: worker.stale_shares || 0,
    rejected_shares: worker.rejected_shares || 0,
    firmware: worker.firmware || ''
  }
}

/**
 * Transform Luxor workers array to MiningOS format
 * @param {LuxorWorker[]} workers - Array of Luxor workers
 * @returns {WorkerStats[]} Normalized workers array
 */
function getWorkersStats (workers) {
  if (!Array.isArray(workers)) return []
  return workers.map(transformWorkerData)
}

/**
 * Extract total mining revenue from revenue array
 * @param {RevenueEntry[]} revenueArray - Array of revenue objects from Luxor
 * @returns {number} Total mining revenue
 */
function extractMiningRevenue (revenueArray) {
  if (!Array.isArray(revenueArray)) return 0

  const miningRevenue = revenueArray.find(r => r.revenue_type === 'MINING')
  return miningRevenue?.revenue || 0
}

/**
 * Extract balance for a specific currency
 * @param {BalanceEntry[]} balanceArray - Array of balance objects from Luxor
 * @param {string} currencyType - Currency type to extract
 * @returns {number} Balance amount
 */
function extractBalance (balanceArray, currencyType = 'BTC') {
  if (!Array.isArray(balanceArray)) return 0

  const balance = balanceArray.find(b => b.currency_type === currencyType)
  return balance?.revenue || 0
}

/**
 * Extract hashprice for a specific currency
 * @param {HashpriceEntry[]} hashpriceArray - Array of hashprice objects from Luxor
 * @param {string} currencyType - Currency type to extract
 * @returns {number} Hashprice value
 */
function extractHashprice (hashpriceArray, currencyType = 'BTC') {
  if (!Array.isArray(hashpriceArray)) return 0

  const hashprice = hashpriceArray.find(h => h.currency_type === currencyType)
  return hashprice?.value || 0
}

/**
 * Transform Luxor summary to MiningOS stats format
 * @param {LuxorSummary} summary - Luxor summary response
 * @param {string} currencyType - Currency type
 * @returns {PoolStats} Normalized stats object
 */
function transformSummaryToStats (summary, currencyType = 'BTC') {
  const revenue24h = extractMiningRevenue(summary.revenue_24h)
  const revenueAllTime = extractMiningRevenue(summary.revenue_all_time)
  const balance = extractBalance(summary.balance, currencyType)
  const hashprice = extractHashprice(summary.hashprice, currencyType)

  return {
    timestamp: Date.now(),
    hashrate: parseFloat(summary.hashrate_5m) || 0,
    hashrate_1h: parseFloat(summary.hashrate_1h) || 0,
    hashrate_24h: parseFloat(summary.hashrate_24h) || 0,
    hashrate_stale_1h: parseFloat(summary.hashrate_stale_1h) || 0,
    hashrate_stale_24h: parseFloat(summary.hashrate_stale_24h) || 0,
    efficiency: summary.efficiency_5m || 0,
    uptime_24h: summary.uptime_24h || 0,
    active_workers_count: summary.active_miners || 0,
    revenue_24h: revenue24h,
    revenue_all_time: revenueAllTime,
    balance,
    hashprice,
    subaccounts: summary.subaccounts || []
  }
}

/**
 * Get monthly date ranges for the past N months
 * @param {number} months - Number of months to get
 * @returns {Object<string, MonthlyDateRange>} Date ranges keyed by month-year
 */
const getMonthlyDateRanges = (months) => {
  const dateRange = {}
  const today = new Date()
  for (let i = 0; i < months; i++) {
    const startDate = new Date(today.getFullYear(), today.getMonth() - i, 1, 0, 0, 0)
    const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 1, 0, 0, 0)
    dateRange[`${startDate.getMonth() + 1}-${startDate.getFullYear()}`] = {
      startDate: startDate.getTime(),
      endDate: endDate.getTime()
    }
  }

  return dateRange
}

/**
 * Check if a month string is the current month
 * @param {string} month - Month string in format "M-YYYY"
 * @returns {boolean} True if current month
 */
const isCurrentMonth = (month) => {
  return parseInt(month.split('-')[0]) === new Date().getMonth() + 1
}

/**
 * Convert milliseconds to seconds
 * @param {number} timestampMs - Timestamp in milliseconds
 * @returns {number} Timestamp in seconds
 */
const convertMsToSeconds = (timestampMs) => {
  return Math.floor(timestampMs / 1000)
}

/**
 * Format date as YYYY-MM-DD string for Luxor API
 * @param {number|Date} timestamp - Timestamp in milliseconds or Date object
 * @returns {string} Date string in YYYY-MM-DD format
 */
const formatDateForApi = (timestamp) => {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Get time ranges for aggregation
 * @param {number} start - Start timestamp in milliseconds
 * @param {number} end - End timestamp in milliseconds
 * @param {boolean} isHourly - Use hourly intervals (default) or daily
 * @returns {TimeRange[]} Array of { start, end } objects
 */
const getTimeRanges = (start, end, isHourly = true) => {
  if (start >= end) return []

  const ranges = []
  const timeDiff = isHourly ? HOUR_MS : HOURS_24_MS
  let endTime = new Date(start + timeDiff)

  if (isHourly) {
    endTime.setUTCMinutes(0, 0, 0)
  } else {
    endTime.setUTCHours(0, 0, 0, 0)
  }

  endTime = endTime.getTime()
  while (start < end) {
    ranges.push({ start, end: endTime })
    start = endTime
    endTime += timeDiff
  }
  return ranges
}

module.exports = {
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
}
