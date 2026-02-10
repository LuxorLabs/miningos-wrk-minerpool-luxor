// In order to run this worker with luxor api-gateway running locally we need to set `NODE_TLS_REJECT_UNAUTHORIZED=0` and it was impossible to do it with a command
module.exports = {
  apps: [{
    name: 'luxor-1',
    script: 'worker.js',
    args: '--wtype wrk-minerpool-rack-luxor --env development --rack rack-1',
    env: {
      DEBUG: 'miningos:*',
      NODE_TLS_REJECT_UNAUTHORIZED: '0'
    }
  }]
}
