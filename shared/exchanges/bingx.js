// ============================================
//  BINGX EXCHANGE CLIENT
//  Поддержка: MARKET, LIMIT, STOP, TAKE_PROFIT
// ============================================

const crypto = require('crypto');

class BingXExchange {
  constructor(apiKey, secretKey, baseUrl = 'https://open-api.bingx.com') {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = baseUrl;
  }

  _sign(params) {
    const sortedKeys = Object.keys(params).sort();
    let queryString = '';
    for (const key of sortedKeys) {
      if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
        if (queryString) queryString += '&';
        queryString += `${key}=${params[key]}`;
      }
    }
    const signature = crypto.createHmac('sha256', this.secretKey).update(queryString).digest('hex');
    return { queryString, signature };
  }

  async _signedPost(endpoint, params = {}) {
    const timestamp = Date.now();
    const allParams = { ...params, timestamp };
    const { queryString, signature } = this._sign(allParams);
    const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;
    
    console.log(`📤 POST URL: ${url}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-BX-APIKEY': this.apiKey,
        'Content-Type': 'application/json',
      },
    });
    const data = await response.json();
    console.log(`📥 Ответ:`, JSON.stringify(data, null, 2));
    return data;
  }

  async _signedGet(endpoint, params = {}) {
    const timestamp = Date.now();
    const allParams = { ...params, timestamp };
    const { queryString, signature } = this._sign(allParams);
    const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;
    
    console.log(`📤 GET URL: ${url}`);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-BX-APIKEY': this.apiKey,
      },
    });
    const data = await response.json();
    return data;
  }

  async getBalance() {
    try {
      const response = await this._signedGet('/openApi/swap/v3/user/balance');
      if (response?.code === 0 && Array.isArray(response?.data)) {
        const usdtAsset = response.data.find(item => item.asset === 'USDT');
        if (usdtAsset) {
          const balance = parseFloat(usdtAsset.balance) || 0;
          console.log(`💰 Баланс: $${balance}`);
          return balance;
        }
        console.error('❌ USDT не найден в балансе');
        return 0;
      }
      console.error('❌ Ошибка получения баланса:', response);
      return 0;
    } catch (error) {
      console.error('❌ Ошибка getBalance:', error.message);
      return 0;
    }
  }

  async getPositions() {
    try {
      const response = await this._signedGet('/openApi/swap/v2/user/positions');
      if (response?.code === 0 && response?.data) {
        return response.data;
      }
      console.error('❌ Ошибка получения позиций:', response);
      return [];
    } catch (error) {
      console.error('❌ Ошибка getPositions:', error.message);
      return [];
    }
  }

  async getContracts() {
    try {
      const response = await this._signedGet('/openApi/swap/v2/quote/contracts');
      if (response?.code === 0 && response?.data) {
        return response.data;
      }
      console.error('❌ Ошибка получения контрактов:', response);
      return [];
    } catch (error) {
      console.error('❌ Ошибка getContracts:', error.message);
      return [];
    }
  }

  async getCandles(symbol, interval = '5m', limit = 100) {
    try {
      const params = { symbol, interval, limit };
      const response = await this._signedGet('/openApi/swap/v3/quote/klines', params);
      if (response?.code === 0 && response?.data) {
        return response.data.map(c => ({
          open: parseFloat(c.open),
          high: parseFloat(c.high),
          low: parseFloat(c.low),
          close: parseFloat(c.close),
          volume: parseFloat(c.volume),
          timestamp: c.timestamp,
        }));
      }
      console.error(`❌ Ошибка получения свечей для ${symbol}:`, response);
      return [];
    } catch (error) {
      console.error(`❌ Ошибка getCandles:`, error.message);
      return [];
    }
  }

  async placeOrder(params) {
    try {
      const {
        symbol,
        side,
        type = 'MARKET',
        quantity,
        price = null,
        leverage = 10,
        positionSide = side === 'BUY' ? 'LONG' : 'SHORT',
      } = params;

      const symbolFormatted = symbol.replace('_', '-');
      const orderParams = {
        symbol: symbolFormatted,
        side: side,
        positionSide: positionSide,
        type: type,
        quantity: quantity.toString(),
        leverage: leverage.toString(),
      };

      if (price && type !== 'MARKET') {
        orderParams.price = price.toString();
      }

      console.log(`📤 РЫНОЧНЫЙ ОРДЕР:`, JSON.stringify(orderParams, null, 2));

      const response = await this._signedPost('/openApi/swap/v2/trade/order', orderParams);
      if (response?.code === 0 && response?.data?.order) {
        console.log(`✅ Ордер создан: ${response.data.order.orderId || response.data.order.orderID}`);
        return response.data.order;
      }
      console.error(`❌ Ошибка ордера:`, response);
      return null;
    } catch (error) {
      console.error(`❌ Ошибка placeOrder:`, error.message);
      return null;
    }
  }

  // ============================================
  //  УСТАНОВКА TP/SL (БЕЗ reduceOnly)
  // ============================================
  async setTPSL(orderId, symbol, side, quantity, stopLoss, takeProfit) {
    try {
      const symbolFormatted = symbol.replace('_', '-');
      const results = [];

      const positionSide = side === 'BUY' ? 'LONG' : 'SHORT';
      const closeSide = positionSide === 'LONG' ? 'SELL' : 'BUY';

      if (stopLoss && stopLoss > 0) {
        const slParams = {
          symbol: symbolFormatted,
          side: closeSide,
          positionSide: positionSide,
          type: 'STOP',
          quantity: quantity.toString(),
          stopPrice: stopLoss.toString(),
          price: stopLoss.toString(),
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
          side: closeSide,
          positionSide: positionSide,
          type: 'TAKE_PROFIT',
          quantity: quantity.toString(),
          stopPrice: takeProfit.toString(),
          price: takeProfit.toString(),
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
      const response = await this._signedPost('/openApi/swap/v2/trade/close', { 
        symbol, 
        positionSide, 
        type: 'MARKET', 
        quantity: '0' 
      });
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