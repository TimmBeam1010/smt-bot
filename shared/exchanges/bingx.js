// ============================================
//  МОДУЛЬ BINGX (с getCandles, getContracts и исправленным TP/SL)
// ============================================

const crypto = require('crypto');
const axios = require('axios');

class BingXExchange {
    constructor(apiKey, secretKey) {
        this.apiKey = apiKey;
        this.secretKey = secretKey;
        this.name = 'bingx';
        this.baseURL = 'https://open-api.bingx.com';
        this.lastRequestTime = 0;
        this.MIN_REQUEST_INTERVAL = 2000; // 2 секунды между запросами
    }

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

    async _signedGet(endpoint, params = {}) {
        await this._waitForRateLimit();
        const { signature, timestamp } = this._generateGetSignature();
        
        let url = `${this.baseURL}${endpoint}`;
        const queryParams = { ...params, timestamp, signature };
        const queryString = Object.keys(queryParams)
            .map(key => `${key}=${encodeURIComponent(queryParams[key])}`)
            .join('&');
        if (queryString) {
            url += `?${queryString}`;
        }
        
        console.log('📤 GET URL:', url);
        const response = await axios.get(url, {
            headers: { 'X-BX-APIKEY': this.apiKey }
        });
        return response.data;
    }

    async _signedPost(endpoint, params = {}) {
        await this._waitForRateLimit();
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

    // 🔧 ПОЛУЧЕНИЕ ЦЕНЫ
    async getPrice(symbol) {
        try {
            const symbolFormatted = symbol.replace('_', '-');
            const params = { symbol: symbolFormatted };
            const response = await this._signedGet('/openApi/swap/v2/quote/price', params);
            if (response?.code === 0) {
                const price = parseFloat(response.data.price);
                console.log(`📊 Цена ${symbol}: $${price}`);
                return price;
            }
            console.error('❌ Ошибка получения цены:', response);
            return null;
        } catch (error) {
            console.error('❌ Ошибка getPrice:', error.message);
            return null;
        }
    }

    // 🔧 ПОЛУЧЕНИЕ СВЕЧЕЙ (ИСПРАВЛЕНО: swap/v3)
    async getCandles(symbol, interval = '5m', limit = 50) {
        try {
            const symbolFormatted = symbol.replace('_', '-');
            const params = {
                symbol: symbolFormatted,
                interval: interval,
                limit: limit
            };
            const response = await this._signedGet('/openApi/swap/v3/quote/klines', params);
            
            console.log('📥 Сырой ответ BingX:', JSON.stringify(response, null, 2));
            
            if (response?.code === 0) {
                if (!Array.isArray(response.data)) {
                    console.error('❌ response.data не является массивом:', typeof response.data);
                    return null;
                }
                return response.data.map(candle => ({
                    timestamp: candle[0],
                    open: parseFloat(candle[1]),
                    high: parseFloat(candle[2]),
                    low: parseFloat(candle[3]),
                    close: parseFloat(candle[4]),
                    volume: parseFloat(candle[5])
                }));
            }
            console.error('❌ Ошибка получения свечей:', response);
            return null;
        } catch (error) {
            console.error('❌ Ошибка getCandles:', error.message);
            return null;
        }
    }

    // 🔧 НОВЫЙ МЕТОД: ПОЛУЧЕНИЕ СПИСКА КОНТРАКТОВ
    async getContracts() {
        try {
            const response = await this._signedGet('/openApi/swap/v2/quote/contracts');
            if (response?.code === 0) {
                return response.data || [];
            }
            console.error('❌ Ошибка получения контрактов:', response);
            return [];
        } catch (error) {
            console.error('❌ Ошибка getContracts:', error.message);
            return [];
        }
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

    // 🔧 ИСПРАВЛЕННЫЙ МЕТОД: РАЗМЕЩЕНИЕ ОРДЕРА С TP/SL
    async placeOrder(symbol, side, quantity, price = null, stopLoss = null, takeProfit = null) {
        try {
            const symbolFormatted = symbol.replace('_', '-');
            const params = {
                symbol: symbolFormatted,
                side: side,
                positionSide: side === 'BUY' ? 'LONG' : 'SHORT',
                type: price ? 'LIMIT' : 'MARKET',
                quantity: quantity.toString()
            };
            
            if (stopLoss) {
                params.stopLoss = JSON.stringify({
                    type: "STOP",
                    stopPrice: parseFloat(stopLoss),
                    price: parseFloat(stopLoss)
                });
            }
            if (takeProfit) {
                params.takeProfit = JSON.stringify({
                    type: "TAKE_PROFIT",
                    stopPrice: parseFloat(takeProfit),
                    price: parseFloat(takeProfit)
                });
            }
            if (price && price > 0) {
                params.price = price.toString();
            }
            
            console.log('📤 Параметры ордера:', JSON.stringify(params, null, 2));
            
            const response = await this._signedPost('/openApi/swap/v2/trade/order', params);
            if (response?.code === 0) {
                return {
                    orderId: response.data.order.orderID || response.data.order.orderId,
                    symbol: symbol,
                    side: side,
                    quantity: quantity,
                    price: price,
                    stopLoss: stopLoss,
                    takeProfit: takeProfit,
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

    async closePosition(symbol, positionSide) {
        try {
            const params = {
                symbol: symbol,
                positionSide: positionSide,
                type: 'MARKET',
                quantity: '0'
            };
            const response = await this._signedPost('/openApi/swap/v2/trade/close', params);
            if (response?.code === 0) {
                return response.data;
            }
            console.error('❌ Ошибка закрытия позиции:', response);
            return null;
        } catch (error) {
            console.error('❌ Ошибка closePosition:', error.message);
            return null;
        }
    }

    async testCredentials() {
        const balance = await this.getBalance();
        return balance !== null && balance !== undefined;
    }
}

module.exports = BingXExchange;