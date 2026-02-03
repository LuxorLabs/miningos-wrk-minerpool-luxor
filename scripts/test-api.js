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
 */

const { LuxorMinerPool } = require('../workers/lib/luxor.minerpool')
const { getWorkersStats, formatDateForApi } = require('../workers/lib/utils')

// Simple HTTP client wrapper for standalone testing
class SimpleHttpClient {
  constructor (baseUrl) {
    this.baseUrl = baseUrl
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

    if (!response.ok) {
      console.error(`✗ HTTP ${response.status}: ${JSON.stringify(body)}`)
      throw new Error(`HTTP ${response.status}: ${body.message || 'Unknown error'}`)
    }

    console.log(`✓ HTTP ${response.status}`)
    return { body }
  }
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
  console.log('='.repeat(60))

  const http = new SimpleHttpClient(apiUrl)
  const client = new LuxorMinerPool(http, apiKey, {
    currencyType,
    pageSize: 10 // Small page size for testing
  })

  const queryOptions = subaccountName ? { subaccountNames: [subaccountName] } : {}
  const results = {}

  // Test 1: Get Summary
  console.log('\n' + '─'.repeat(60))
  console.log('TEST 1: Get Summary')
  console.log('─'.repeat(60))
  try {
    const summary = await client.getSummary(queryOptions)
    results.summary = summary

    console.log('\nResponse:')
    console.log(`  Hashrate (5m):     ${summary.hashrate_5m || 'N/A'}`)
    console.log(`  Hashrate (24h):    ${summary.hashrate_24h || 'N/A'}`)
    console.log(`  Efficiency (5m):   ${summary.efficiency_5m || 'N/A'}`)
    console.log(`  Uptime (24h):      ${summary.uptime_24h || 'N/A'}`)
    console.log(`  Active Miners:     ${summary.active_miners || 'N/A'}`)
    console.log(`  Subaccounts:       ${summary.subaccounts?.length || 0}`)

    if (summary.revenue_24h) {
      console.log('  Revenue (24h):')
      summary.revenue_24h.forEach(r => {
        console.log(`    - ${r.revenue_type}: ${r.revenue} ${r.currency_type}`)
      })
    }

    if (summary.balance) {
      console.log('  Balance:')
      summary.balance.forEach(b => {
        console.log(`    - ${b.currency_type}: ${b.revenue}`)
      })
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
    const workersResult = await client.getWorkers({ ...queryOptions, pageSize: 5 })
    results.workers = workersResult

    console.log('\nResponse:')
    console.log(`  Total Active:      ${workersResult.total_active || 0}`)
    console.log(`  Total Inactive:    ${workersResult.total_inactive || 0}`)
    console.log(`  Workers returned:  ${workersResult.workers?.length || 0}`)
    console.log(`  Has next page:     ${!!workersResult.pagination?.next_page_url}`)

    if (workersResult.workers?.length > 0) {
      console.log('\n  Sample Worker:')
      const w = workersResult.workers[0]
      console.log(`    ID:              ${w.id}`)
      console.log(`    Name:            ${w.name}`)
      console.log(`    Subaccount:      ${w.subaccount_name}`)
      console.log(`    Status:          ${w.status}`)
      console.log(`    Hashrate:        ${w.hashrate}`)
      console.log(`    Efficiency:      ${w.efficiency}`)
      console.log(`    Last Share:      ${w.last_share_time}`)

      // Test transformation
      console.log('\n  Transformed Worker (MiningOS format):')
      const transformed = getWorkersStats([w])
      console.log(`    online:          ${transformed[0].online}`)
      console.log(`    last_updated:    ${transformed[0].last_updated}`)
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
    const endDate = new Date()
    const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000)

    const transactions = await client.getTransactions({
      ...queryOptions,
      startDate: formatDateForApi(startDate),
      endDate: formatDateForApi(endDate),
      pageSize: 5
    })
    results.transactions = transactions

    console.log('\nResponse:')
    console.log(`  Transactions:      ${transactions.transactions?.length || 0}`)
    console.log(`  Has next page:     ${!!transactions.pagination?.next_page_url}`)

    if (transactions.transactions?.length > 0) {
      console.log('\n  Sample Transaction:')
      const tx = transactions.transactions[0]
      console.log(`    ID:              ${tx.transaction_id}`)
      console.log(`    Type:            ${tx.transaction_type}`)
      console.log(`    Category:        ${tx.transaction_category}`)
      console.log(`    Amount:          ${tx.currency_amount} ${tx.currency_type}`)
      console.log(`    USD Equivalent:  $${tx.usd_equivalent}`)
      console.log(`    Date:            ${tx.date_time}`)
      console.log(`    Subaccount:      ${tx.subaccount_name}`)
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
    const poolHashrate = await client.getPoolHashrate(queryOptions)
    results.poolHashrate = poolHashrate

    console.log('\nResponse:')
    console.log(JSON.stringify(poolHashrate, null, 2).split('\n').slice(0, 20).join('\n'))
    if (Object.keys(poolHashrate).length > 10) {
      console.log('  ... (truncated)')
    }

    console.log('\n✓ Pool Hashrate test PASSED')
  } catch (e) {
    console.error(`\n✗ Pool Hashrate test FAILED: ${e.message}`)
    results.poolHashrate = { error: e.message }
  }

  // Test 5: Get Hashrate Efficiency (last 7 days)
  console.log('\n' + '─'.repeat(60))
  console.log('TEST 5: Get Hashrate Efficiency (last 7 days)')
  console.log('─'.repeat(60))
  try {
    const endDate = new Date()
    const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000)

    const efficiency = await client.getHashrateEfficiency({
      ...queryOptions,
      startDate: formatDateForApi(startDate),
      endDate: formatDateForApi(endDate),
      tickSize: '1d'
    })
    results.efficiency = efficiency

    console.log('\nResponse:')
    console.log(JSON.stringify(efficiency, null, 2).split('\n').slice(0, 20).join('\n'))
    if (JSON.stringify(efficiency).length > 500) {
      console.log('  ... (truncated)')
    }

    console.log('\n✓ Hashrate Efficiency test PASSED')
  } catch (e) {
    console.error(`\n✗ Hashrate Efficiency test FAILED: ${e.message}`)
    results.efficiency = { error: e.message }
  }

  // Test 6: Get Uptime (last 7 days)
  console.log('\n' + '─'.repeat(60))
  console.log('TEST 6: Get Uptime (last 7 days)')
  console.log('─'.repeat(60))
  try {
    const endDate = new Date()
    const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000)

    const uptime = await client.getUptime({
      ...queryOptions,
      startDate: formatDateForApi(startDate),
      endDate: formatDateForApi(endDate),
      tickSize: '1d'
    })
    results.uptime = uptime

    console.log('\nResponse:')
    console.log(JSON.stringify(uptime, null, 2).split('\n').slice(0, 20).join('\n'))
    if (JSON.stringify(uptime).length > 500) {
      console.log('  ... (truncated)')
    }

    console.log('\n✓ Uptime test PASSED')
  } catch (e) {
    console.error(`\n✗ Uptime test FAILED: ${e.message}`)
    results.uptime = { error: e.message }
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('TEST SUMMARY')
  console.log('='.repeat(60))

  const tests = ['summary', 'workers', 'transactions', 'poolHashrate', 'efficiency', 'uptime']
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

  // Save full response for debugging
  if (process.env.DEBUG) {
    const fs = require('fs')
    const outputPath = '/tmp/luxor-api-test-results.json'
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2))
    console.log(`\nFull responses saved to: ${outputPath}`)
  }

  process.exit(failed > 0 ? 1 : 0)
}

runTests().catch(e => {
  console.error('Unexpected error:', e)
  process.exit(1)
})
