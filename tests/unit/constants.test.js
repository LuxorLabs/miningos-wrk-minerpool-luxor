'use strict'

const test = require('brittle')
const {
  TRANSACTION_TYPES,
  WORKER_STATUS,
  POOL_TYPE,
  CURRENCY,
  SCHEDULER_TIMES,
  MINUTE_MS,
  HOUR_MS,
  HOURS_24_MS,
  BTC_SATS,
  DEFAULT_PAGE_SIZE
} = require('../../workers/lib/constants')

test('constants: TRANSACTION_TYPES should have correct values', (t) => {
  t.is(TRANSACTION_TYPES.CREDIT, 'credit')
  t.is(TRANSACTION_TYPES.DEBIT, 'debit')
})

test('constants: WORKER_STATUS should have correct values', (t) => {
  t.is(WORKER_STATUS.ACTIVE, 'ACTIVE')
  t.is(WORKER_STATUS.INACTIVE, 'INACTIVE')
  t.is(WORKER_STATUS.UNSPECIFIED, 'UNSPECIFIED')
})

test('constants: POOL_TYPE should be luxor', (t) => {
  t.is(POOL_TYPE, 'luxor')
})

test('constants: CURRENCY should be BTC', (t) => {
  t.is(CURRENCY, 'BTC')
})

test('constants: SCHEDULER_TIMES should have correct intervals', (t) => {
  t.is(SCHEDULER_TIMES._1M.key, '1m')
  t.is(SCHEDULER_TIMES._5M.key, '5m')
  t.is(SCHEDULER_TIMES._1D.key, '1D')

  t.ok(SCHEDULER_TIMES._1M.time.includes('*/1'))
  t.ok(SCHEDULER_TIMES._5M.time.includes('*/5'))
  t.ok(SCHEDULER_TIMES._1D.time.includes('0 0 0'))
})

test('constants: time constants should be correct', (t) => {
  t.is(MINUTE_MS, 60 * 1000)
  t.is(HOUR_MS, 60 * 60 * 1000)
  t.is(HOURS_24_MS, 24 * 60 * 60 * 1000)
})

test('constants: BTC_SATS should be 100 million', (t) => {
  t.is(BTC_SATS, 100000000)
})

test('constants: DEFAULT_PAGE_SIZE should be 100', (t) => {
  t.is(DEFAULT_PAGE_SIZE, 100)
})
