// ============================================
//  МОДУЛЬ BINGX (С ИСПОЛЬЗОВАНИЕМ ОФИЦИАЛЬНОЙ БИБЛИОТЕКИ)
// ============================================

const { BingxApiClient } = require('bingx-api');

class BingXExchange {
    constructor(apiKey, secretKey) {
        this.apiKey = apiKey;
        this.secretKey = secretKey;
        this.name = 'bingx';

        // Инициализируем клиент
        this.client = new BingxApiClient({
            apiKey: this.apiKey,
            apiSecret: this.secretKey,
            baseURL: 'https://open-api.bingx.com'
        });
    }

    // Получение баланса фьючерсного счёта
    async getBalance() {
        try {
            // Используем метод для получения баланса
            const response = await this.client.account.balance();
            
            if (response && response.code === 0) {
                const usdtData = response.data?.balance?.find(item => item.asset === 'USDT');
                if (usdtData) {
                    return parseFloat(usdtData.equity) || parseFloat(usdtData.balance) || 0;
                }
                return 0;
            }
            console.error('❌ BingX: Ошибка баланса', response);
            return null;
        } catch (error) {
            console.error('❌ BingX: Ошибка getBalance', error.message);
            return null;
        }
    }

    // Создание ордера на фьючерсном рынке
    async placeOrder(symbol, side, quantity, price = null) {
        try {
            const symbolFormatted = symbol.replace('-', '_');
            
            const orderParams = {
                symbol: symbolFormatted,
                side: side,
                type: 'MARKET',
                quantity: quantity.toString(),
                positionSide: side === 'BUY' ? 'LONG' : 'SHORT'
            };

            if (price && price > 0) {
                orderParams.type = 'LIMIT';
                orderParams.price = price.toString();
            }

            console.log('📝 Отправка ордера:', orderParams);

            // Используем метод для создания ордера
            const response = await this.client.trade.order(orderParams);

            if (response && response.code === 0) {
                return {
                    orderId: response.data.orderId,
                    symbol: symbol,
                    side: side,
                    quantity: quantity,
                    price: price,
                    status: 'filled'
                };
            }
            console.error('❌ BingX: Ошибка ордера', response);
            return null;
        } catch (error) {
            console.error('❌ BingX: Ошибка placeOrder', error.response?.data || error.message);
            return null;
        }
    }

    // Проверка ключей
    async testCredentials() {
        const balance = await this.getBalance();
        return balance !== null && balance !== undefined;
    }
}

module.exports = BingXExchange;