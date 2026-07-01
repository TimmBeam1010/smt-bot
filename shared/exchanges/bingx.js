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
        try {
            const symbolFormatted = symbol.replace('-', '_');
            const orderParams = {
                symbol: symbolFormatted,
                side: side,
                type: price ? 'LIMIT' : 'MARKET',
                quantity: quantity.toString()
            };
            if (price) {
                orderParams.price = price.toString();
                orderParams.positionSide = side === 'BUY' ? 'LONG' : 'SHORT';
            }
            console.log('📤 Отправка ордера через библиотеку:', orderParams);
            const response = await this.client.trade.order(orderParams);
            if (response?.code === 0) {
                return {
                    orderId: response.data.orderId,
                    symbol: symbol,
                    side: side,
                    quantity: quantity,
                    price: price,
                    status: 'filled'
                };
            }
            console.error('❌ Ошибка ордера:', response);
            return null;
        } catch (error) {
            console.error('❌ Ошибка placeOrder:', error.message);
            return null;
        }
    }

    async testCredentials() {
        const balance = await this.getBalance();
        return balance !== null && balance !== undefined;
    }
}

module.exports = BingXExchange;