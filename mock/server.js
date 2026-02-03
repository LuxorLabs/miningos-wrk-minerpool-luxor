'use strict'

const fastify = require('fastify')

if (require.main === module) {
  const argv = {
    port: process.env.PORT || 8000,
    host: process.env.HOST || '127.0.0.1',
    subaccounts: (process.env.SUBACCOUNTS || 'testsubaccount').split(','),
    delay: parseInt(process.env.DELAY || '0', 10)
  }
  createServer(argv)
  console.log(`Mock Luxor server started on http://${argv.host}:${argv.port}`)
} else {
  module.exports = { createServer }
}

function createServer (argv) {
  const CTX = {
    startTime: Date.now(),
    host: argv.host,
    port: argv.port,
    delay: argv.delay || 0,
    subaccounts: argv.subaccounts || ['testsubaccount']
  }

  const STATE = createInitialState(CTX)

  const app = fastify()

  // Authentication middleware
  app.addHook('onRequest', (req, res, done) => {
    const apiKey = req.headers.authorization
    if (!apiKey || !apiKey.startsWith('api-')) {
      res.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid or missing API key'
      })
      return
    }
    req.ctx = CTX
    req.state = STATE
    done()
  })

  // Delay middleware
  app.addHook('onSend', (req, res, payload, done) => {
    if (CTX.delay > 0) {
      setTimeout(() => done(null, payload), CTX.delay)
    } else {
      done(null, payload)
    }
  })

  // Register routes
  registerRoutes(app)

  app.listen({ port: argv.port, host: argv.host }, (err) => {
    if (err) throw err
  })

  return {
    app,
    state: STATE,
    stop: () => app.close(),
    reset: () => Object.assign(STATE, createInitialState(CTX))
  }
}

function createInitialState (ctx) {
  const currencyType = 'BTC'
  const workers = []
  for (let i = 0; i < 10; i++) {
    const workerName = `miner${i}`
    workers.push({
      currency_type: currencyType,
      id: `${currencyType}-${ctx.subaccounts[0]}-${workerName}`,
      subaccount_name: ctx.subaccounts[0],
      name: workerName,
      firmware: 'LuxOS',
      hashrate: i < 8 ? 100000000000 + Math.random() * 10000000000 : 0,
      efficiency: i < 8 ? 0.98 + Math.random() * 0.02 : 0,
      stale_shares: Math.random() * 0.02,
      rejected_shares: Math.random() * 0.01,
      last_share_time: new Date().toISOString(),
      status: i < 8 ? 'ACTIVE' : 'INACTIVE'
    })
  }

  return {
    subaccounts: ctx.subaccounts.map((name, i) => ({
      id: i + 1,
      name,
      site: i === 0 ? null : { id: `site-${i}`, name: `Site ${i}` }
    })),
    workers,
    transactions: generateTransactions(ctx.subaccounts[0]),
    summary: {
      hashrate_5m: '800000000000000',
      hashrate_24h: '780000000000000',
      efficiency_5m: 0.99,
      uptime_24h: 0.995,
      active_miners: 8,
      revenue_24h: [{ currency_type: 'BTC', revenue_type: 'MINING', revenue: 0.01 }],
      revenue_all_time: [{ currency_type: 'BTC', revenue_type: 'MINING', revenue: 1.5 }],
      balance: [{ currency_type: 'BTC', revenue: 0.5 }],
      hashprice: [{ currency_type: 'BTC', value: 0.00059 }]
    }
  }
}

function generateTransactions (subaccountName) {
  const transactions = []
  const now = Date.now()
  for (let i = 0; i < 10; i++) {
    transactions.push({
      transaction_id: `tx-${i}`,
      transaction_type: i % 3 === 0 ? 'debit' : 'credit',
      transaction_category: i % 3 === 0 ? 'Transaction Fee' : 'Miner Revenue',
      currency_amount: 0.001 + Math.random() * 0.01,
      currency_type: 'BTC',
      usd_equivalent: 50 + Math.random() * 500,
      date_time: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      address_name: 'wallet-1',
      subaccount_name: subaccountName
    })
  }
  return transactions
}

function validateSubaccount (req, res) {
  const subaccountNames = req.query.subaccount_names
  const siteId = req.query.site_id

  if (!subaccountNames && !siteId) {
    res.status(400).send({
      statusCode: 400,
      code: 'FST_ERR_VALIDATION',
      error: 'Bad Request',
      message: 'querystring/subaccount_names/site_id Provide one or more subaccount names or a site id'
    })
    return false
  }
  return true
}

function registerRoutes (app) {
  // Get subaccounts
  app.get('/v2/pool/subaccounts', (req, res) => {
    res.send({
      subaccounts: req.state.subaccounts,
      pagination: {
        page_number: 1,
        page_size: 10,
        item_count: req.state.subaccounts.length,
        previous_page_url: null,
        next_page_url: null
      }
    })
  })

  // Get summary
  app.get('/v2/pool/summary/:currency_type', (req, res) => {
    if (!validateSubaccount(req, res)) return

    res.send({
      currency_type: req.params.currency_type,
      subaccounts: req.state.subaccounts,
      ...req.state.summary
    })
  })

  // Get workers
  app.get('/v2/pool/workers/:currency_type', (req, res) => {
    if (!validateSubaccount(req, res)) return

    const pageNumber = parseInt(req.query.page_number || '1', 10)
    const pageSize = parseInt(req.query.page_size || '10', 10)
    const status = req.query.status

    let workers = req.state.workers
    if (status) {
      workers = workers.filter(w => w.status === status)
    }

    const start = (pageNumber - 1) * pageSize
    const end = start + pageSize
    const pagedWorkers = workers.slice(start, end)

    const totalActive = req.state.workers.filter(w => w.status === 'ACTIVE').length
    const totalInactive = req.state.workers.filter(w => w.status === 'INACTIVE').length
    const totalWorkers = workers.length

    res.send({
      currency_type: req.params.currency_type,
      subaccounts: req.state.subaccounts,
      total_inactive: totalInactive,
      total_active: totalActive,
      workers: pagedWorkers,
      pagination: {
        page_number: pageNumber,
        page_size: pageSize,
        item_count: totalWorkers,
        previous_page_url: pageNumber > 1 ? `/v2/pool/workers/${req.params.currency_type}?page_number=${pageNumber - 1}` : null,
        next_page_url: end < workers.length ? `/v2/pool/workers/${req.params.currency_type}?page_number=${pageNumber + 1}` : null
      }
    })
  })

  // Get transactions
  app.get('/v2/pool/transactions/:currency_type', (req, res) => {
    if (!validateSubaccount(req, res)) return

    if (!req.query.start_date || !req.query.end_date) {
      return res.status(400).send({
        statusCode: 400,
        code: 'FST_ERR_VALIDATION',
        error: 'Bad Request',
        message: 'querystring/start_date Required, querystring/end_date Required'
      })
    }

    const pageNumber = parseInt(req.query.page_number || '1', 10)
    const pageSize = parseInt(req.query.page_size || '10', 10)
    const start = (pageNumber - 1) * pageSize
    const end = start + pageSize
    const pagedTransactions = req.state.transactions.slice(start, end)

    res.send({
      transactions: pagedTransactions,
      pagination: {
        page_number: pageNumber,
        page_size: pageSize,
        item_count: pagedTransactions.length,
        previous_page_url: pageNumber > 1 ? 'prev' : null,
        next_page_url: end < req.state.transactions.length ? 'next' : null
      }
    })
  })

  // Get pool hashrate (global - no subaccount required)
  app.get('/v2/pool/pool-hashrate/:currency_type', (req, res) => {
    res.send({
      currency_type: req.params.currency_type,
      hashrate_5m: '40000000000000000000',
      hashrate_1h: '39500000000000000000',
      hashrate_24h: '38000000000000000000'
    })
  })

  // Get hashrate efficiency
  app.get('/v2/pool/hashrate-efficiency/:currency_type', (req, res) => {
    if (!validateSubaccount(req, res)) return

    if (!req.query.start_date || !req.query.end_date || !req.query.tick_size) {
      return res.status(400).send({
        statusCode: 400,
        code: 'FST_ERR_VALIDATION',
        error: 'Bad Request',
        message: 'querystring/start_date Required, querystring/end_date Required, querystring/tick_size Required'
      })
    }

    // Generate efficiency data points
    const efficiencyData = []
    const startDate = new Date(req.query.start_date)
    const endDate = new Date(req.query.end_date)
    const dayMs = 24 * 60 * 60 * 1000

    for (let d = new Date(startDate); d <= endDate; d = new Date(d.getTime() + dayMs)) {
      efficiencyData.push({
        date_time: d.toISOString(),
        hashrate: String(800000000000000 + Math.random() * 100000000000000),
        efficiency: 0.99 + Math.random() * 0.01
      })
    }

    res.send({
      currency_type: req.params.currency_type,
      start_date: req.query.start_date,
      end_date: req.query.end_date,
      tick_size: req.query.tick_size,
      subaccounts: req.state.subaccounts,
      hashrate_efficiency: efficiencyData,
      pagination: {
        page_number: 1,
        page_size: 10,
        item_count: efficiencyData.length,
        previous_page_url: null,
        next_page_url: null
      }
    })
  })

  // Get uptime
  app.get('/v2/pool/uptime/:currency_type', (req, res) => {
    if (!validateSubaccount(req, res)) return

    if (!req.query.start_date || !req.query.end_date || !req.query.tick_size) {
      return res.status(400).send({
        statusCode: 400,
        code: 'FST_ERR_VALIDATION',
        error: 'Bad Request',
        message: 'querystring/start_date Required, querystring/end_date Required, querystring/tick_size Required'
      })
    }

    // Generate uptime data points
    const uptimeData = []
    const startDate = new Date(req.query.start_date)
    const endDate = new Date(req.query.end_date)
    const dayMs = 24 * 60 * 60 * 1000

    for (let d = new Date(startDate); d <= endDate; d = new Date(d.getTime() + dayMs)) {
      uptimeData.push({
        date_time: d.toISOString(),
        uptime: 0.95 + Math.random() * 0.05
      })
    }

    res.send({
      currency_type: req.params.currency_type,
      start_date: req.query.start_date,
      end_date: req.query.end_date,
      tick_size: req.query.tick_size,
      subaccounts: req.state.subaccounts,
      uptime: uptimeData,
      pagination: {
        page_number: 1,
        page_size: 10,
        item_count: uptimeData.length,
        previous_page_url: null,
        next_page_url: null
      }
    })
  })

  // Get revenue
  app.get('/v2/pool/revenue/:currency_type', (req, res) => {
    if (!validateSubaccount(req, res)) return

    res.send({
      currency_type: req.params.currency_type,
      subaccounts: req.state.subaccounts,
      revenue: req.state.summary.revenue_24h
    })
  })
}
