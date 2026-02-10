#!/usr/bin/env node
'use strict'

/**
 * Manual API Integration Test Script
 *
 * Usage:
 *   node scripts/test-api.js
 *
 * Environment variables:
 *   LUXOR_API_KEY    - Your Luxor API key (required)
 *   LUXOR_API_URL    - API base URL (default: https://app.luxor.tech/api)
 *   LUXOR_CURRENCY   - Currency type (default: BTC)
 *   LUXOR_SUBACCOUNT - Subaccount name (optional)
 *
 * Output:
 *   Saves raw API response snapshots to tests/snapshots/
 */

const fs = require('fs')
const path = require('path')
const { LuxorMinerPool } = require('../workers/lib/luxor.minerpool')
const { getWorkersStats, formatDateForApi } = require('../workers/lib/utils')

// Snapshot directory
const SNAPSHOTS_DIR = path.join(__dirname, '..', 'tests', 'snapshots')

// Simple HTTP client wrapper that captures raw responses
class SimpleHttpClient {
  constructor (baseUrl) {
    this.baseUrl = baseUrl
    this.rawResponses = []
  }

  async get (path, options = {}) {
    const url = `${this.baseUrl}${path}`
    console.log(`\n→ GET ${url}`)

    const response = await fetch(url, {
      method: 'GET',
      headers: options.headers || {},
      signal: AbortSignal.timeout(options.timeout || 30000)
    })

    const body = await response.json()

    // Capture raw response for snapshots
    this.rawResponses.push({
      path,
      status: response.status,
      body
    })

    if (!response.ok) {
      console.error(`✗ HTTP ${response.status}: ${JSON.stringify(body)}`)
      throw new Error(`HTTP ${response.status}: ${body.message || 'Unknown error'}`)
    }

    console.log(`✓ HTTP ${response.status}`)
    return { body }
  }

  getRawResponses () {
    return this.rawResponses
  }

  clearResponses () {
    this.rawResponses = []
  }
}

function ensureSnapshotsDir () {
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true })
  }
}

function saveSnapshot (name, data) {
  ensureSnapshotsDir()
  const filePath = path.join(SNAPSHOTS_DIR, `${name}.json`)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
  console.log(`  📸 Snapshot saved: tests/snapshots/${name}.json`)
}

async function runTests () {
  // Configuration
  const apiKey = process.env.LUXOR_API_KEY
  const apiUrl = process.env.LUXOR_API_URL || 'https://app.luxor.tech/api'
  const currencyType = process.env.LUXOR_CURRENCY || 'BTC'
  const subaccountName = process.env.LUXOR_SUBACCOUNT || null

  if (!apiKey) {
    console.error('Error: LUXOR_API_KEY environment variable is required')
    console.error('\nUsage:')
    console.error('  LUXOR_API_KEY=your-api-key node scripts/test-api.js')
    console.error('\nOptional environment variables:')
    console.error('  LUXOR_API_URL    - API base URL (default: https://app.luxor.tech/api)')
    console.error('  LUXOR_CURRENCY   - Currency type: BTC, LTC_DOGE, SC, ZEC (default: BTC)')
    console.error('  LUXOR_SUBACCOUNT - Subaccount name to filter by')
    process.exit(1)
  }

  console.log('='.repeat(60))
  console.log('Luxor API Integration Test')
  console.log('='.repeat(60))
  console.log(`API URL:    ${apiUrl}`)
  console.log(`Currency:   ${currencyType}`)
  console.log(`Subaccount: ${subaccountName || '(all)'}`)
  console.log(`Snapshots:  ${SNAPSHOTS_DIR}`)
  console.log('='.repeat(60))

  const http = new SimpleHttpClient(apiUrl)
  const client = new LuxorMinerPool(http, apiKey, {
    currencyType,
    pageSize: 10 // Small page size for testing
  })

  const queryOptions = subaccountName ? { subaccountNames: [subaccountName] } : {}
  const results = {}
  const snapshots = {}

  // Test 1: Get Summary
  console.log('\n' + '─'.repeat(60))
  console.log('TEST 1: Get Summary')
  console.log('─'.repeat(60))
  try {
    http.clearResponses()
    const summary = await client.getSummary(queryOptions)
    results.summary = summary
    snapshots.summary = http.getRawResponses()[0]?.body
    saveSnapshot('summary', snapshots.summary)

    console.log('\nResponse Structure:')
    console.log(`  hashrate_5m:        ${typeof summary.hashrate_5m} = ${summary.hashrate_5m}`)
    console.log(`  hashrate_1h:        ${typeof summary.hashrate_1h} = ${summary.hashrate_1h}`)
    console.log(`  hashrate_24h:       ${typeof summary.hashrate_24h} = ${summary.hashrate_24h}`)
    console.log(`  hashrate_stale_1h:  ${typeof summary.hashrate_stale_1h} = ${summary.hashrate_stale_1h}`)
    console.log(`  hashrate_stale_24h: ${typeof summary.hashrate_stale_24h} = ${summary.hashrate_stale_24h}`)
    console.log(`  efficiency_5m:      ${typeof summary.efficiency_5m} = ${summary.efficiency_5m}`)
    console.log(`  uptime_24h:         ${typeof summary.uptime_24h} = ${summary.uptime_24h}`)
    console.log(`  active_miners:      ${typeof summary.active_miners} = ${summary.active_miners}`)
    console.log(`  revenue_24h:        ${Array.isArray(summary.revenue_24h) ? 'array' : typeof summary.revenue_24h}[${summary.revenue_24h?.length}]`)
    console.log(`  revenue_all_time:   ${Array.isArray(summary.revenue_all_time) ? 'array' : typeof summary.revenue_all_time}[${summary.revenue_all_time?.length}]`)
    console.log(`  balance:            ${Array.isArray(summary.balance) ? 'array' : typeof summary.balance}[${summary.balance?.length}]`)
    console.log(`  hashprice:          ${Array.isArray(summary.hashprice) ? 'array' : typeof summary.hashprice}[${summary.hashprice?.length}]`)
    console.log(`  subaccounts:        ${Array.isArray(summary.subaccounts) ? 'array' : typeof summary.subaccounts}[${summary.subaccounts?.length}]`)

    if (summary.revenue_24h?.length > 0) {
      console.log('\n  revenue_24h[0] structure:')
      const r = summary.revenue_24h[0]
      Object.keys(r).forEach(k => console.log(`    ${k}: ${typeof r[k]} = ${r[k]}`))
    }

    if (summary.balance?.length > 0) {
      console.log('\n  balance[0] structure:')
      const b = summary.balance[0]
      Object.keys(b).forEach(k => console.log(`    ${k}: ${typeof b[k]} = ${b[k]}`))
    }

    console.log('\n✓ Summary test PASSED')
  } catch (e) {
    console.error(`\n✗ Summary test FAILED: ${e.message}`)
    results.summary = { error: e.message }
  }

  // Test 2: Get Workers (first page)
  console.log('\n' + '─'.repeat(60))
  console.log('TEST 2: Get Workers (first page)')
  console.log('─'.repeat(60))
  try {
    http.clearResponses()
    const workersResult = await client.getWorkers({ ...queryOptions, pageSize: 5 })
    results.workers = workersResult
    snapshots.workers = http.getRawResponses()[0]?.body
    saveSnapshot('workers', snapshots.workers)

    console.log('\nResponse Structure:')
    console.log(`  total_active:      ${typeof workersResult.total_active} = ${workersResult.total_active}`)
    console.log(`  total_inactive:    ${typeof workersResult.total_inactive} = ${workersResult.total_inactive}`)
    console.log(`  workers:           array[${workersResult.workers?.length}]`)
    console.log(`  pagination:        ${typeof workersResult.pagination}`)

    if (workersResult.workers?.length > 0) {
      console.log('\n  workers[0] structure:')
      const w = workersResult.workers[0]
      Object.keys(w).forEach(k => console.log(`    ${k}: ${typeof w[k]} = ${JSON.stringify(w[k]).substring(0, 50)}`))

      console.log('\n  Transformed (MiningOS format):')
      const transformed = getWorkersStats([w])
      Object.keys(transformed[0]).forEach(k => console.log(`    ${k}: ${typeof transformed[0][k]} = ${transformed[0][k]}`))
    }

    if (workersResult.pagination) {
      console.log('\n  pagination structure:')
      Object.keys(workersResult.pagination).forEach(k => console.log(`    ${k}: ${workersResult.pagination[k]}`))
    }

    console.log('\n✓ Workers test PASSED')
  } catch (e) {
    console.error(`\n✗ Workers test FAILED: ${e.message}`)
    results.workers = { error: e.message }
  }

  // Test 3: Get Transactions (last 7 days)
  console.log('\n' + '─'.repeat(60))
  console.log('TEST 3: Get Transactions (last 7 days)')
  console.log('─'.repeat(60))
  try {
    http.clearResponses()
    const endDate = new Date()
    const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000)

    const transactions = await client.getTransactions({
      ...queryOptions,
      startDate: formatDateForApi(startDate),
      endDate: formatDateForApi(endDate),
      pageSize: 5
    })
    results.transactions = transactions
    snapshots.transactions = http.getRawResponses()[0]?.body
    saveSnapshot('transactions', snapshots.transactions)

    console.log('\nResponse Structure:')
    console.log(`  transactions:      array[${transactions.transactions?.length}]`)
    console.log(`  pagination:        ${typeof transactions.pagination}`)

    if (transactions.transactions?.length > 0) {
      console.log('\n  transactions[0] structure:')
      const tx = transactions.transactions[0]
      Object.keys(tx).forEach(k => console.log(`    ${k}: ${typeof tx[k]} = ${JSON.stringify(tx[k]).substring(0, 50)}`))
    }

    console.log('\n✓ Transactions test PASSED')
  } catch (e) {
    console.error(`\n✗ Transactions test FAILED: ${e.message}`)
    results.transactions = { error: e.message }
  }

  // Test 4: Get Pool Hashrate
  console.log('\n' + '─'.repeat(60))
  console.log('TEST 4: Get Pool Hashrate')
  console.log('─'.repeat(60))
  try {
    http.clearResponses()
    const poolHashrate = await client.getPoolHashrate(queryOptions)
    results.poolHashrate = poolHashrate
    snapshots.poolHashrate = http.getRawResponses()[0]?.body
    saveSnapshot('pool-hashrate', snapshots.poolHashrate)

    console.log('\nResponse Structure:')
    Object.keys(poolHashrate).forEach(k => console.log(`  ${k}: ${typeof poolHashrate[k]} = ${poolHashrate[k]}`))

    console.log('\n✓ Pool Hashrate test PASSED')
  } catch (e) {
    console.error(`\n✗ Pool Hashrate test FAILED: ${e.message}`)
    results.poolHashrate = { error: e.message }
  }

  // Test 6: Get Uptime (last 7 days)
  console.log('\n' + '─'.repeat(60))
  console.log('TEST 6: Get Uptime (last 7 days)')
  console.log('─'.repeat(60))
  try {
    http.clearResponses()
    const endDate = new Date()
    const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000)

    const uptime = await client.getUptime({
      ...queryOptions,
      startDate: formatDateForApi(startDate),
      endDate: formatDateForApi(endDate),
      tickSize: '1d'
    })
    results.uptime = uptime
    snapshots.uptime = http.getRawResponses()[0]?.body
    saveSnapshot('uptime', snapshots.uptime)

    console.log('\nResponse Structure:')
    console.log(`  uptime: array[${uptime.uptime?.length}]`)

    if (uptime.uptime?.length > 0) {
      console.log('\n  uptime[0] structure:')
      const u = uptime.uptime[0]
      Object.keys(u).forEach(k => console.log(`    ${k}: ${typeof u[k]} = ${u[k]}`))
    }

    console.log('\n✓ Uptime test PASSED')
  } catch (e) {
    console.error(`\n✗ Uptime test FAILED: ${e.message}`)
    results.uptime = { error: e.message }
  }

  // Test 7: Get Subaccounts
  console.log('\n' + '─'.repeat(60))
  console.log('TEST 7: Get Subaccounts')
  console.log('─'.repeat(60))
  try {
    http.clearResponses()
    const subaccounts = await client.getSubaccounts()
    results.subaccounts = subaccounts
    snapshots.subaccounts = http.getRawResponses()[0]?.body
    saveSnapshot('subaccounts', snapshots.subaccounts)

    console.log('\nResponse Structure:')
    console.log(`  subaccounts: array[${subaccounts.subaccounts?.length}]`)

    if (subaccounts.subaccounts?.length > 0) {
      console.log('\n  subaccounts[0] structure:')
      const s = subaccounts.subaccounts[0]
      Object.keys(s).forEach(k => console.log(`    ${k}: ${typeof s[k]} = ${s[k]}`))
    }

    console.log('\n✓ Subaccounts test PASSED')
  } catch (e) {
    console.error(`\n✗ Subaccounts test FAILED: ${e.message}`)
    results.subaccounts = { error: e.message }
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('TEST SUMMARY')
  console.log('='.repeat(60))

  const tests = ['summary', 'workers', 'transactions', 'poolHashrate', 'efficiency', 'uptime', 'subaccounts']
  let passed = 0
  let failed = 0

  tests.forEach(test => {
    const status = results[test]?.error ? '✗ FAILED' : '✓ PASSED'
    if (results[test]?.error) {
      failed++
      console.log(`  ${status}: ${test} - ${results[test].error}`)
    } else {
      passed++
      console.log(`  ${status}: ${test}`)
    }
  })

  console.log('\n' + '─'.repeat(60))
  console.log(`Results: ${passed} passed, ${failed} failed`)
  console.log('='.repeat(60))

  // Save combined snapshot
  saveSnapshot('all-responses', snapshots)
  console.log('\n✓ All snapshots saved to tests/snapshots/')

  process.exit(failed > 0 ? 1 : 0)
}

runTests().catch(e => {
  console.error('Unexpected error:', e)
  process.exit(1)
})
