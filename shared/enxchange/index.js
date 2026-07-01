// ============================================
//  ФАБРИКА БИРЖ
// ============================================

const BingXExchange = require('./bingx');

function getExchange(exchange, apiKey, secretKey) {
    switch (exchange) {
        case 'bingx':
            return new BingXExchange(apiKey, secretKey);
        // case 'binance':
        //     return new BinanceExchange(apiKey, secretKey);
        default:
            throw new Error(`Биржа ${exchange} не поддерживается`);
    }
}

module.exports = { getExchange };