// ============================================
//  BINGX EXCHANGE CLIENT (ФИНАЛЬНАЯ ВЕРСИЯ)
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
    return crypto.createHmac('sha256', this.secretKey).update(queryString).digest('hex');
  }

  async _request(method, endpoint, params = {}, body = null) {
    const timestamp = Date.now();
    
    // ВСЕ параметры участвуют в подписи
    const allParams = { ...params, ...body, timestamp };
    const sortedKeys = Object.keys(allParams).sort();
    let queryString = '';
    for (const key of sortedKeys) {
      if (allParams[key] !== undefined && allParams[key] !== null && allParams[key] !== '') {
        if (queryString) queryString += '&';
        queryString += `${key}=${allParams[key]}`;
      }
    }
    const signature = this._sign(allParams);
    const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;
    
    // Тело: параметры ордера (без timestamp)
    const requestBody = body ? { ...body } : {};
    
    console.log(`📤 ${method} URL: ${url}`);
    console.log(`📤 BODY:`, JSON.stringify(requestBody, null, 2));
    
    const response = await fetch(url, {
      method: method,
      headers: {
        'X-BX-APIKEY': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    
    const data = await response.json();
    console.log(`📥 ОТВЕТ:`, JSON.stringify(data, null, 2));
    return data;
  }

  async getBalance() {
    try {
      const response = await this._request('GET', '/openApi/swap/v3/user/balance');
      if (response?.code === 0 && Array.isArray(response?.data)) {
        const usdt = response.data.find(a => a.asset === 'USDT');
        return parseFloat(usdt?.balance || 0);
      }
      return 0;
    } catch (error) {
      console.error('❌ getBalance error:', error.message);
      return 0;
    }
  }

  async getPositions() {
    try {
      const response = await this._request('GET', '/openApi/swap/v2/user/positions');
      if (response?.code === 0 && response?.data) {
        return response.data;
      }
      return [];
    } catch (error) {
      console.error('❌ getPositions error:', error.message);
      return [];
    }
  }

  async getContracts() {
    try {
      const response = await this._request('GET', '/openApi/swap/v2/quote/contracts');
      if (response?.code === 0 && response?.data) {
        return response.data;
      }
      return [];
    } catch (error) {
      console.error('❌ getContracts error:', error.message);
      return [];
    }
  }

  async getCandles(symbol, interval = '5m', limit = 100) {
    try {
      const response = await this._request('GET', '/openApi/swap/v3/quote/klines', { symbol, interval, limit });
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
      return [];
    } catch (error) {
      console.error('❌ getCandles error:', error.message);
      return [];
    }
  }

  async placeOrder(params) {
    try {
      const { symbol, side, type = 'MARKET', quantity, price = null } = params;
      
      const orderData = {
        symbol: symbol.replace('_', '-'),
        side: side,
        type: type,
        quantity: quantity.toString(),
      };
      
      if (price && type !== 'MARKET') {
        orderData.price = price.toString();
      }
      
      console.log(`📤 РЫНОЧНЫЙ ОРДЕР:`, JSON.stringify(orderData, null, 2));
      
      const response = await this._request('POST', '/openApi/swap/v2/trade/order', {}, orderData);
      
      if (response?.code === 0 && response?.data?.order) {
        console.log(`✅ Ордер создан: ${response.data.order.orderId || response.data.order.orderID}`);
        return response.data.order;
      }
      
      console.error(`❌ Ошибка ордера:`, response);
      return null;
    } catch (error) {
      console.error(`❌ placeOrder error:`, error.message);
      return null;
    }
  }

  async closePosition(symbol, positionSide) {
    try {
      const response = await this._request('POST', '/openApi/swap/v2/trade/close', {}, {
        symbol: symbol.replace('_', '-'),
        positionSide: positionSide,
        type: 'MARKET',
        quantity: '0',
      });
      if (response?.code === 0) return response.data;
      return null;
    } catch (error) {
      console.error('❌ closePosition error:', error.message);
      return null;
    }
  }

  async testCredentials() {
    const balance = await this.getBalance();
    return balance !== null && balance !== undefined;
  }
}

module.exports = BingXExchange;