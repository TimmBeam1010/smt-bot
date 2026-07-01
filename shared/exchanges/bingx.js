const { BingxApiClient } = require('bingx-api');

class BingXExchange {
    constructor(apiKey, secretKey) {
        this.apiKey = apiKey;
        this.secretKey = secretKey;
        this.name = 'bingx';

        // Создаём клиент
        this.client = new BingxApiClient({
            apiKey: this.apiKey,
            apiSecret: this.secretKey,
            baseURL: 'https://open-api.bingx.com'
        });
    }

    async getBalance() {
        try {
            // Используем официальный метод
            const response = await this.client.account.balance();
            if (response?.code === 0) {
                const usdtData = response.data?.balance?.find(item => item.asset === 'USDT');
                if (usdtData) {
                    return parseFloat(usdtData.equity) || parseFloat(usdtData.balance) || 0;
                }
                return 0;
            }
            console.error('❌ Баланс:', response);
            return null;
        } catch (error) {
            console.error('❌ Ошибка getBalance:', error.message);
            return null;
        }
    }

    async placeOrder(symbol, side, quantity, price = null) {
        console.log('🔍 placeOrder получил price:', price, 'тип:', typeof price);
        try {
            const symbolFormatted = symbol.replace('_', '-');
            const params = {
                symbol: symbolFormatted,
                side: side,
                type: 'MARKET',
                quantity: quantity.toString()
            };
            // positionSide и recvWindow ТОЛЬКО для LIMIT ордеров
            if (price && price > 0) {
                params.type = 'LIMIT';
                params.price = price.toString();
                params.positionSide = side === 'BUY' ? 'LONG' : 'SHORT';
                params.recvWindow = '5000';
            }
            const response = await this._signedPost('/openApi/swap/v2/trade/order', params);
            // ...
        }
    }

    async testCredentials() {
        const balance = await this.getBalance();
        return balance !== null && balance !== undefined;
    }
}

module.exports = BingXExchange;