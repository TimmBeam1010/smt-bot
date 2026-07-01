// ============================================
//  МОДУЛЬ BINGX (ФЬЮЧЕРСЫ) - ОКОНЧАТЕЛЬНОЕ ИСПРАВЛЕНИЕ
// ============================================

const crypto = require('crypto');
const axios = require('axios');

class BingXExchange {
    constructor(apiKey, secretKey) {
        this.apiKey = apiKey;
        this.secretKey = secretKey;
        this.name = 'bingx';
    }

    // Получение баланса
    async getBalance() {
        try {
            const timestamp = Date.now().toString();
            const payload = `timestamp=${timestamp}`;
            const signature = crypto.createHmac('sha256', this.secretKey)
                .update(payload)
                .digest('hex');

            const url = `https://open-api.bingx.com/openApi/swap/v3/user/balance?${payload}&signature=${signature}`;

            const response = await axios.get(url, {
                headers: { 'X-BX-APIKEY': this.apiKey },
                timeout: 10000
            });

            if (response.data?.code === 0 && response.data?.data) {
                const usdtData = response.data.data.find(item => item.asset === 'USDT');
                if (usdtData) {
                    return parseFloat(usdtData.equity) || parseFloat(usdtData.balance) || 0;
                }
                return 0;
            }
            console.error('❌ BingX: Ошибка баланса', response.data);
            return null;
        } catch (error) {
            console.error('❌ BingX: Ошибка getBalance', error.message);
            return null;
        }
    }

    // Создание ордера (ПАРАМЕТРЫ В ТЕЛЕ, ПОДПИСЬ В ЗАГОЛОВКЕ)
    async placeOrder(symbol, side, quantity, price = null) {
        try {
            const timestamp = Date.now().toString();
            const formattedSymbol = symbol.replace('-', '_');

            // Параметры для тела запроса
            const params = {
                symbol: formattedSymbol,
                side: side,
                positionSide: side === "BUY" ? "LONG" : "SHORT",
                type: 'MARKET',
                quantity: quantity.toString(),
                timestamp: timestamp,
                recvWindow: '5000'
            };

            // Сортируем параметры для подписи
            const sortedKeys = Object.keys(params).sort();
            let queryString = '';
            for (const key of sortedKeys) {
                if (queryString) queryString += '&';
                queryString += `${key}=${params[key]}`;
            }

            // ПОДПИСЬ: HMAC-SHA256 от queryString
            const signature = crypto.createHmac('sha256', this.secretKey)
                .update(queryString)
                .digest('hex');

            console.log('📝 Подпись для ордера (тело запроса):', {
                params,
                signature,
                queryString
            });

            const url = 'https://open-api.bingx.com/openApi/swap/v2/trade/order';

            const response = await axios.post(url, params, {
                headers: {
                    'X-BX-APIKEY': this.apiKey,
                    'X-BX-SIGNATURE': signature,
                    'X-BX-TIMESTAMP': timestamp,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });

            if (response.data?.code === 0) {
                return {
                    orderId: response.data.data.orderId,
                    symbol: symbol,
                    side: side,
                    quantity: quantity,
                    price: price,
                    status: 'filled'
                };
            }
            console.error('❌ BingX: Ошибка ордера (тело запроса)', response.data);
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