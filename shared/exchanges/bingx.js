const crypto = require('crypto');
const axios = require('axios');

class BingXExchange {
    constructor(apiKey, secretKey) {
        this.apiKey = apiKey;
        this.secretKey = secretKey;
        this.name = 'bingx';
        this.baseURL = 'https://open-api.bingx.com';
    }

    _generateSignature(params, timestamp) {
        // Формируем строку параметров
        let parameters = '';
        for (const key in params) {
            parameters += `${key}=${params[key]}&`;
        }
        parameters += `timestamp=${timestamp}`;
        
        // HMAC-SHA256 подпись
        return crypto
            .createHmac('sha256', this.secretKey)
            .update(parameters)
            .digest('hex');
    }

    async _signedPost(endpoint, params = {}) {
        const timestamp = Date.now().toString();
        const signature = this._generateSignature(params, timestamp);
        
        // Формируем URL с параметрами
        const queryParams = new URLSearchParams();
        for (const key in params) {
            queryParams.append(key, params[key]);
        }
        queryParams.append('timestamp', timestamp);
        queryParams.append('signature', signature);
        
        const url = `${this.baseURL}${endpoint}?${queryParams.toString()}`;
        
        console.log('📤 Отправка ордера:', {
            url: url,
            params: params
        });

        const response = await axios({
            method: 'POST',
            url: url,
            headers: {
                'X-BX-APIKEY': this.apiKey,
                'Content-Type': 'application/json'
            }
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
                const usdtData = response.data.data?.balance?.find(item => item.asset === 'USDT');
                if (usdtData) {
                    return parseFloat(usdtData.equity) || parseFloat(usdtData.balance) || 0;
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
        try {
            // ВАЖНО: для фьючерсов используем дефис!
            const symbolFormatted = symbol.replace('_', '-');
            
            const params = {
                symbol: symbolFormatted,
                side: side,
                positionSide: side === 'BUY' ? 'LONG' : 'SHORT',
                type: 'MARKET',
                quantity: quantity.toString()
            };

            // Для LIMIT ордеров добавляем цену
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
            return error.response?.data || null;
        }
    }

    async testCredentials() {
        const balance = await this.getBalance();
        return balance !== null && balance !== undefined;
    }
}

module.exports = BingXExchange;