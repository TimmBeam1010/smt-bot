// ============================================
//  МОДУЛЬ BINGX (С ПРАВИЛЬНЫМИ РЫНОЧНЫМИ ОРДЕРАМИ)
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
        this.MIN_REQUEST_INTERVAL = 2000;
    }

    async _waitForRateLimit() {
        const now = Date.now();
        const waitTime = Math.max(0, this.MIN_REQUEST_INTERVAL - (now - this.lastRequestTime));
        if (waitTime > 0) await new Promise(resolve => setTimeout(resolve, waitTime));
        this.lastRequestTime = Date.now();
    }

    _generateGetSignature() {
        const timestamp = Date.now().toString();
        const signature = crypto.createHmac('sha256', this.secretKey).update(`timestamp=${timestamp}`).digest('hex');
        return { signature, timestamp };
    }

    _generatePostSignature(params) {
        const timestamp = Date.now().toString();
        let paramsStr = '';
        for (const key in params) paramsStr += `${key}=${params[key]}&`;
        paramsStr = paramsStr.slice(0, -1) + `&timestamp=${timestamp}`;
        const signature = crypto.createHmac('sha256', this.secretKey).update(paramsStr).digest('hex');
        return { signature, timestamp };
    }

    async _signedGet(endpoint, params = {}) {
        await this._waitForRateLimit();
        const { signature, timestamp } = this._generateGetSignature();
        let url = `${this.baseURL}${endpoint}`;
        const queryParams = { ...params, timestamp, signature };
        const queryString = Object.keys(queryParams).map(k => `${k}=${encodeURIComponent(queryParams[k])}`).join('&');
        if (queryString) url += `?${queryString}`;
        console.log('📤 GET URL:', url);
        const response = await axios.get(url, { headers: { 'X-BX-APIKEY': this.apiKey } });
        return response.data;
    }

    async _signedPost(endpoint, params = {}) {
        await this._waitForRateLimit();
        const { signature, timestamp } = this._generatePostSignature(params);
        const queryParams = { ...params, timestamp, signature };
        const queryString = Object.keys(queryParams).map(k => `${k}=${encodeURIComponent(queryParams[k])}`).join('&');
        const url = `${this.baseURL}${endpoint}?${queryString}`;
        console.log('📤 POST URL:', url);
        const response = await axios.post(url, null, { headers: { 'X-BX-APIKEY': this.apiKey } });
        console.log('📥 Ответ:', JSON.stringify(response.data, null, 2));
        return response.data;
    }

    async getPrice(symbol) {
        try {
            const symbolFormatted = symbol.replace('_', '-');
            const response = await this._signedGet('/openApi/swap/v2/quote/price', { symbol: symbolFormatted });
            if (response?.code === 0) return parseFloat(response.data.price);
            console.error('❌ Ошибка получения цены:', response);
            return null;
        } catch (error) {
            console.error('❌ Ошибка getPrice:', error.message);
            return null;
        }
    }

    async getCandles(symbol, interval = '5m', limit = 50) {
        try {
            const symbolFormatted = symbol.replace('_', '-');
            const response = await this._signedGet('/openApi/swap/v3/quote/klines', { symbol: symbolFormatted, interval, limit });
            if (response?.code === 0 && Array.isArray(response.data)) {
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

    async getContracts() {
        try {
            const response = await this._signedGet('/openApi/swap/v2/quote/contracts');
            if (response?.code === 0) return response.data || [];
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
                const usdtData = (response.data || []).find(item => item.asset === 'USDT');
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
            if (response?.code === 0) return response.data || [];
            console.error('❌ Ошибка получения позиций:', response);
            return [];
        } catch (error) {
            console.error('❌ Ошибка getPositions:', error.message);
            return [];
        }
    }

    // ===== РЫНОЧНЫЙ ОРДЕР (БЕЗ ЦЕНЫ) =====
    async placeOrder(params) {
        try {
            const {
                symbol,
                side,
                type = 'MARKET', // ← ВСЕГДА MARKET
                quantity,
                price = null,
                leverage = 10,
                positionSide = side === 'BUY' ? 'LONG' : 'SHORT'
            } = params;

            const symbolFormatted = symbol.replace('_', '-');
            const orderParams = {
                symbol: symbolFormatted,
                side: side,
                positionSide: positionSide,
                type: 'MARKET', // ← ПРИНУДИТЕЛЬНО MARKET
                quantity: quantity.toString()
            };

            if (leverage) orderParams.leverage = leverage.toString();
            // НЕ ДОБАВЛЯЕМ price для MARKET ордеров!

            console.log('📤 РЫНОЧНЫЙ ОРДЕР:', JSON.stringify(orderParams, null, 2));

            const response = await this._signedPost('/openApi/swap/v2/trade/order', orderParams);
            if (response?.code === 0) {
                const orderData = {
                    orderId: response.data.order.orderID || response.data.order.orderId,
                    symbol,
                    side,
                    quantity,
                    price,
                    status: 'filled'
                };
                console.log('✅ Ордер создан:', orderData.orderId);
                return orderData;
            }
            console.error('❌ Ошибка ордера:', response);
            return null;
        } catch (error) {
            console.error('❌ Ошибка placeOrder:', error.message);
            return null;
        }
    }

    // ===== УСТАНОВКА TP/SL =====
    async setTPSL(orderId, symbol, side, quantity, stopLoss, takeProfit) {
        try {
            const symbolFormatted = symbol.replace('_', '-');
            const results = [];

            if (stopLoss && stopLoss > 0) {
                const slParams = {
                    symbol: symbolFormatted,
                    side: side,
                    type: 'STOP_MARKET',
                    positionSide: side === 'BUY' ? 'LONG' : 'SHORT',
                    quantity: quantity.toString(),
                    stopPrice: stopLoss.toString(),
                    price: stopLoss.toString()
                };
                console.log('📤 Установка SL:', JSON.stringify(slParams, null, 2));
                const slResponse = await this._signedPost('/openApi/swap/v2/trade/order', slParams);
                if (slResponse?.code === 0) {
                    console.log('✅ SL установлен:', stopLoss);
                    results.push({ type: 'SL', status: 'success' });
                } else {
                    console.error('❌ Ошибка установки SL:', slResponse);
                    results.push({ type: 'SL', status: 'failed', error: slResponse });
                }
            }

            if (takeProfit && takeProfit > 0) {
                const tpParams = {
                    symbol: symbolFormatted,
                    side: side,
                    type: 'TAKE_PROFIT_MARKET',
                    positionSide: side === 'BUY' ? 'LONG' : 'SHORT',
                    quantity: quantity.toString(),
                    stopPrice: takeProfit.toString(),
                    price: takeProfit.toString()
                };
                console.log('📤 Установка TP:', JSON.stringify(tpParams, null, 2));
                const tpResponse = await this._signedPost('/openApi/swap/v2/trade/order', tpParams);
                if (tpResponse?.code === 0) {
                    console.log('✅ TP установлен:', takeProfit);
                    results.push({ type: 'TP', status: 'success' });
                } else {
                    console.error('❌ Ошибка установки TP:', tpResponse);
                    results.push({ type: 'TP', status: 'failed', error: tpResponse });
                }
            }

            return results;
        } catch (error) {
            console.error('❌ Ошибка setTPSL:', error.message);
            return null;
        }
    }

    async closePosition(symbol, positionSide) {
        try {
            const response = await this._signedPost('/openApi/swap/v2/trade/close', { symbol, positionSide, type: 'MARKET', quantity: '0' });
            if (response?.code === 0) return response.data;
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
