// ============================================
//  МОДУЛЬ BINGX (С ИСПОЛЬЗОВАНИЕМ БИБЛИОТЕКИ)
// ============================================

const BingXClient = require('bingx-api').default;

class BingXExchange {
    constructor(apiKey, secretKey) {
        this.apiKey = apiKey;
        this.secretKey = secretKey;
        this.name = 'bingx';

        // Создаём клиент для фьючерсов
        this.client = new BingXClient({
            apiKey: this.apiKey,
            apiSecret: this.secretKey,
            // Важно: указываем, что работаем с фьючерсами
            baseURL: 'https://open-api.bingx.com'
        });
    }

    // Получение баланса (v3)
    async getBalance() {
        try {
            // Используем метод библиотеки для получения баланса
            const response = await this.client.futuresAccountBalance();
            
            if (response && response.code === 0 && response.data) {
                const usdtData = response.data.find(item => item.asset === 'USDT');
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

    // Создание ордера
    async placeOrder(symbol, side, quantity, price = null) {
        try {
            // Подготовка параметров для библиотеки
            const orderParams = {
                symbol: symbol.replace('-', '_'), // Библиотека ждёт формат с подчёркиванием
                side: side, // 'BUY' или 'SELL'
                type: 'MARKET', // или 'LIMIT'
                quantity: quantity.toString(),
                // Для MARKET ордера price не нужен
            };

            // Если цена передана и тип LIMIT, добавляем её
            if (price && orderParams.type === 'LIMIT') {
                orderParams.price = price.toString();
            }

            console.log('📝 Отправка ордера через библиотеку:', orderParams);

            // Используем метод библиотеки для создания ордера
            const response = await this.client.futuresPlaceOrder(orderParams);

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
            console.error('❌ BingX: Ошибка ордера (библиотека)', response);
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