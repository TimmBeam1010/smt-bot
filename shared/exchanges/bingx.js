// ============================================
//  МОДУЛЬ BINGX (РУЧНАЯ ПОДПИСЬ)
// ============================================

const crypto = require('crypto');
const axios = require('axios');

class BingXExchange {
    constructor(apiKey, secretKey) {
        this.apiKey = apiKey;
        this.secretKey = secretKey;
        this.name = 'bingx';
        this.baseURL = 'https://open-api.bingx.com';
    }

    // Генерация подписи
    _generateSignature(params, timestamp) {
        // Сортируем параметры
        const sortedParams = Object.keys(params)
            .sort()
            .map(key => `${key}=${params[key]}`)
            .join('&');
        
        // Строка для подписи: timestamp + sortedParams
        const signatureString = `${timestamp}${sortedParams}`;
        
        // HMAC-SHA256
        return crypto
            .createHmac('sha256', this.secretKey)
            .update(signatureString)
            .digest('hex');
    }

    // HTTP-запрос с подписью
    async _signedRequest(method, endpoint, params = {}) {
        const timestamp = Date.now().toString();
        
        // Добавляем обязательные параметры
        const allParams = {
            ...params,
            timestamp: timestamp
        };

        // Генерируем подпись
        const signature = this._generateSignature(allParams, timestamp);
        
        // URL с параметрами
        const url = `${this.baseURL}${endpoint}`;
        const queryString = Object.keys(allParams)
            .map(key => `${key}=${encodeURIComponent(allParams[key])}`)
            .join('&');

        const fullUrl = method === 'GET' ? `${url}?${queryString}` : url;

        const headers = {
            'X-BX-APIKEY': this.apiKey,
            'Content-Type': 'application/json'
        };

        const config = {
            method: method,
            url: fullUrl,
            headers: headers
        };

        if (method === 'POST') {
            config.data = allParams;
        }

        try {
            const response = await axios(config);
            return response.data;
        } catch (error) {
            console.error(`❌ BingX: Ошибка запроса ${endpoint}`, error.response?.data || error.message);
            throw error;
        }
    }

    // Получение баланса (фьючерсы)
    async getBalance() {
        try {
            const response = await this._signedRequest(
                'GET',
                '/openApi/swap/v3/user/balance'
            );

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

    // Создание ордера (фьючерсы)
    async placeOrder(symbol, side, quantity, price = null) {
        try {
            // Формат символа для фьючерсов
            const symbolFormatted = symbol.replace('-', '_');

            const params = {
                symbol: symbolFormatted,
                side: side, // BUY или SELL
                type: 'MARKET',
                quantity: quantity.toString(),
                positionSide: 'LONG' // или 'SHORT' в зависимости от side
            };

            // Для LIMIT ордеров добавляем цену
            if (price && params.type === 'LIMIT') {
                params.price = price.toString();
            }

            // Добавляем recvWindow (обязательно для фьючерсов)
            params.recvWindow = '5000';

            console.log('📝 Отправка ордера:', { ...params, timestamp: '***' });

            const response = await this._signedRequest(
                'POST',
                '/openApi/swap/v3/trade/order',
                params
            );

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