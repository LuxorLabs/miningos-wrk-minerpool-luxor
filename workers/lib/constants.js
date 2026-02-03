'use strict'

const TRANSACTION_TYPES = {
  CREDIT: 'credit',
  DEBIT: 'debit'
}

const WORKER_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  UNSPECIFIED: 'UNSPECIFIED'
}

const STAT_5M = 'stat-5m'
const STAT_WORKERS = 'stat-workers'
const STAT_TRANSACTIONS = 'stat-transactions'
const MINERPOOL_TAG = 't-minerpool'
const CURRENCY = 'BTC'
const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const HOURS_24_MS = 24 * 60 * 60 * 1000
const POOL_TYPE = 'luxor'
const BTC_SATS = 100000000 // 1 BTC = 100,000,000 satoshis

const DEFAULT_PAGE_SIZE = 100

const SCHEDULER_TIMES = {
  _1M: { time: '0 */1 * * * *', key: '1m' },
  _5M: { time: '0 */5 * * * *', key: '5m' },
  _1D: { time: '0 0 0 * * *', key: '1D' }
}

module.exports = {
  TRANSACTION_TYPES,
  WORKER_STATUS,
  STAT_5M,
  STAT_WORKERS,
  STAT_TRANSACTIONS,
  MINERPOOL_TAG,
  CURRENCY,
  SCHEDULER_TIMES,
  MINUTE_MS,
  HOUR_MS,
  HOURS_24_MS,
  POOL_TYPE,
  BTC_SATS,
  DEFAULT_PAGE_SIZE
}
