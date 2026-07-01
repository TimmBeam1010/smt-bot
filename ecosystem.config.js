{
    name: 'exchange-connector',
    script: 'bots/exchange-connector/index.js',
    instances: 1,
    watch: false,
    env: {
        NODE_ENV: 'production',
        EXCHANGE_CONNECTOR_PORT: 5001
    }
}