module.exports = {
    apps: [
        {
            name: 'smt-website',
            script: 'api/server.js',
            instances: 1,
            watch: false,
            env: {
                NODE_ENV: 'production',
                PORT: 5000
            }
        },
        {
            name: 'exchange-connector',
            script: 'bots/exchange-connector/index.js',
            instances: 1,
            watch: false,
            env: {
                NODE_ENV: 'production',
                EXCHANGE_CONNECTOR_PORT: 5001
            }
        },
        {
            name: 'signal-generator',
            script: 'bots/signal-generator/index.js',
            instances: 1,
            watch: false,
            env: {
                NODE_ENV: 'production'
            }
        },
        {
            name: 'trade-executor',
            script: 'bots/trade-executor/index.js',
            instances: 1,
            watch: false,
            env: {
                NODE_ENV: 'production'
            }
        }
    ]
};