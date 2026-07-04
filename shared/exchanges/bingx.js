const crypto = require('crypto');
const axios = require('axios');

class BingXExchange {
    constructor(apiKey, secretKey) {
        this.apiKey = apiKey;
        this.secretKey = secretKey;
        this.name = 'bingx';
        this.baseURL = 'https://open-api.bingx.com';
        this.lastRequestTime = 0;
        this.MIN_REQUEST_INTERVAL = 500; // 500 мс между запросами
    }

    // ⚠️ НОВЫЙ МЕТОД: ограничение частоты запросов
    async _waitForRateLimit() {
        const now = Date.now();
        const waitTime = Math.max(0, this.MIN_REQUEST_INTERVAL - (now - this.lastRequestTime));
        if (waitTime > 0) {
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        this.lastRequestTime = Date.now();
    }

    _generateGetSignature() {
        const timestamp = Date.now().toString();
        const paramsStr = `timestamp=${timestamp}`;
        const signature = crypto
            .createHmac('sha256', this.secretKey)
            .update(paramsStr)
            .digest('hex');
        return { signature, timestamp };
    }

    _generatePostSignature(params) {
        const timestamp = Date.now().toString();
        let paramsStr = '';
        for (const key in params) {
            paramsStr += `${key}=${params[key]}&`;
        }
        paramsStr = paramsStr.slice(0, -1);
        paramsStr += `&timestamp=${timestamp}`;
        
        const signature = crypto
            .createHmac('sha256', this.secretKey)
            .update(paramsStr)
            .digest('hex');
        
        return { signature, timestamp };
    }

    async _signedGet(endpoint) {
        await this._waitForRateLimit(); // ⚠️ Ждём перед запросом
        const { signature, timestamp } = this._generateGetSignature();
        const url = `${this.baseURL}${endpoint}?timestamp=${timestamp}&signature=${signature}`;
        console.log('📤 GET URL:', url);
        const response = await axios.get(url, {
            headers: { 'X-BX-APIKEY': this.apiKey }
        });
        return response.data;
    }

    async _signedPost(endpoint, params = {}) {
        await this._waitForRateLimit(); // ⚠️ Ждём перед запросом
        const { signature, timestamp } = this._generatePostSignature(params);
        const queryParams = { ...params, timestamp, signature };
        const queryString = Object.keys(queryParams)
            .map(key => `${key}=${encodeURIComponent(queryParams[key])}`)
            .join('&');
        const url = `${this.baseURL}${endpoint}?${queryString}`;
        console.log('📤 POST URL:', url);
        const response = await axios.post(url, null, {
            headers: { 'X-BX-APIKEY': this.apiKey }
        });
        console.log('📥 Ответ:', JSON.stringify(response.data, null, 2));
        return response.data;
    }

    async getBalance() {
        try {
            const response = await this._signedGet('/openApi/swap/v3/user/balance');
            if (response?.code === 0) {
                const assets = response.data || [];
                const usdtData = assets.find(item => item.asset === 'USDT');
                if (usdtData) {
                    const balance = parseFloat(usdtData.equity) || parseFloat(usdtData.balance) || 0;
                    console.log(`💰 Баланс: $${balance}`);
                    return balance;
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

    async getPositions() {
        try {
            const response = await this._signedGet('/openApi/swap/v2/user/positions');
            if (response?.code === 0) {
                return response.data || [];
            }
            console.error('❌ Ошибка получения позиций:', response);
            return [];
        } catch (error) {
            console.error('❌ Ошибка getPositions:', error.message);
            return [];
        }
    }

    async placeOrder(symbol, side, quantity, price = null) {
        try {
            const symbolFormatted = symbol.replace('_', '-');
            const params = {
                symbol: symbolFormatted,
                side: side,
                positionSide: side === 'BUY' ? 'LONG' : 'SHORT',
                type: price ? 'LIMIT' : 'MARKET',
                quantity: quantity.toString()
            };
            if (price && price > 0) {
                params.price = price.toString();
            }
            const response = await this._signedPost('/openApi/swap/v2/trade/order', params);
            if (response?.code === 0) {
                return {
                    orderId: response.data.orderID || response.data.order.orderId,
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