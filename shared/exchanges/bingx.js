const crypto = require('crypto');
const axios = require('axios');

class BingXExchange {
    constructor(apiKey, secretKey) {
        this.apiKey = apiKey;
        this.secretKey = secretKey;
        this.name = 'bingx';
        this.baseURL = 'https://open-api.bingx.com';
    }

    _generateSignature(params) {
        const sortedParams = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
        return crypto.createHmac('sha256', this.secretKey).update(sortedParams).digest('hex');
    }

    async _signedPost(endpoint, params = {}) {
        const timestamp = Date.now().toString();
        const allParams = { ...params, timestamp };
        const signature = this._generateSignature(allParams);
        const body = { ...allParams, signature };
        
        console.log('📤 Отправка POST:', JSON.stringify(body, null, 2));
        
        const response = await axios.post(`${this.baseURL}${endpoint}`, body, {
            headers: { 'X-BX-APIKEY': this.apiKey, 'Content-Type': 'application/json' }
        });
        return response.data;
    }

    async getBalance() {
        try {
            const timestamp = Date.now().toString();
            const signature = crypto
                .createHmac('sha256', this.secretKey)
                .update(`timestamp=${timestamp}`)
                .digest('hex');
            
            const url = `${this.baseURL}/openApi/swap/v3/user/balance?timestamp=${timestamp}&signature=${signature}`;
            
            const response = await axios.get(url, {
                headers: { 'X-BX-APIKEY': this.apiKey }
            });
            
            if (response?.data?.code === 0) {
                const assets = response.data.data || [];
                const usdtData = assets.find(item => item.asset === 'USDT');
                if (usdtData) {
                    const balance = parseFloat(usdtData.equity) || parseFloat(usdtData.balance) || 0;
                    console.log(`💰 Баланс: $${balance}`);
                    return balance;
                }
                return 0;
            }
            console.error('❌ Баланс:', response?.data);
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
                positionSide: side,
                type: 'MARKET',
                quantity: quantity.toString()
            };
            if (price && price > 0) {
                params.type = 'LIMIT';
                params.price = price.toString();
            }
            const response = await this._signedPost('/openApi/swap/v2/trade/order', params);
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