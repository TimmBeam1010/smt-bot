// ============================================
//  BINGX EXCHANGE CLIENT - ИСПРАВЛЕННАЯ ВЕРСИЯ
//  FIX: Убран positionSide из MARKET ордеров
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

    // ============ GET ЗАПРОСЫ ============
    if (method === 'GET') {
      const allParams = { ...params, timestamp };
      const signature = this._sign(allParams);
      
      const queryString = Object.keys(allParams)
        .sort()
        .map(key => `${key}=${allParams[key]}`)
        .join('&');
      
      const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;
      
      console.log(`📤 GET ${url}`);
      
      const options = {
        method: 'GET',
        headers: {
          'X-BX-APIKEY': this.apiKey,
          'Content-Type': 'application/json',
        },
      };
      
      const response = await fetch(url, options);
      const data = await response.json();
      console.log(`📥 ОТВЕТ:`, JSON.stringify(data, null, 2));
      return data;
    }

    // ============ POST ЗАПРОСЫ ============
    if (method === 'POST') {
      const requestBody = { ...body, timestamp };
      
      const cleanBody = {};
      for (const key of Object.keys(requestBody)) {
        if (requestBody[key] !== undefined && requestBody[key] !== null) {
          cleanBody[key] = requestBody[key];
        }
      }
      
      const signature = this._sign(cleanBody);
      cleanBody.signature = signature;
      
      const url = `${this.baseUrl}${endpoint}`;
      
      console.log(`📤 POST ${url}`);
      console.log(`📤 BODY:`, JSON.stringify(cleanBody, null, 2));
      
      const options = {
        method: 'POST',
        headers: {
          'X-BX-APIKEY': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cleanBody),
      };
      
      const response = await fetch(url, options);
      const data = await response.json();
      console.log(`📥 ОТВЕТ:`, JSON.stringify(data, null, 2));
      return data;
    }
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
      const response = await this._request('GET', '/openApi/swap/v3/quote/klines', { 
        symbol, 
        interval, 
        limit 
      });
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

  async getMarketPrice(symbol) {
    try {
      const response = await this._request('GET', '/openApi/swap/v2/quote/price', {
        symbol: symbol.replace(/_/g, '-'),
      });
      
      if (response?.code === 0 && response?.data?.price) {
        return parseFloat(response.data.price);
      }
      return null;
    } catch (error) {
      console.error('❌ getMarketPrice error:', error.message);
      return null;
    }
  }

  async getOpenOrders(symbol = null) {
    try {
      const params = {};
      if (symbol) {
        params.symbol = symbol.replace(/_/g, '-');
      }
      
      const response = await this._request('GET', '/openApi/swap/v2/trade/openOrders', params);
      
      if (response?.code === 0) {
        return response.data || [];
      }
      return [];
    } catch (error) {
      console.error('❌ getOpenOrders error:', error.message);
      return [];
    }
  }

  async getOrderHistory(symbol, limit = 50) {
    try {
      const response = await this._request('GET', '/openApi/swap/v2/trade/history', {
        symbol: symbol.replace(/_/g, '-'),
        limit: limit,
      });
      
      if (response?.code === 0) {
        return response.data || [];
      }
      return [];
    } catch (error) {
      console.error('❌ getOrderHistory error:', error.message);
      return [];
    }
  }

  // =============================================
  //  placeOrder - БЕЗ positionSide
  // =============================================
  async placeOrder(params) {
    try {
      const { symbol, side, type = 'MARKET', quantity, price = null } = params;
      
      const normalizedSymbol = symbol.replace(/_/g, '-');
      
      const orderData = {
        symbol: normalizedSymbol,
        side: side.toUpperCase(),  // BUY или SELL
        type: type.toUpperCase(),  // MARKET или LIMIT
        quantity: quantity.toString(),
      };
      
      // Только для LIMIT ордеров добавляем цену
      if (price && type !== 'MARKET') {
        orderData.price = price.toString();
      }
      
      console.log(`📤 ОРДЕР:`, JSON.stringify(orderData, null, 2));
      
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
      const normalizedSymbol = symbol.replace(/_/g, '-');
      
      const response = await this._request('POST', '/openApi/swap/v2/trade/close', {}, {
        symbol: normalizedSymbol,
        positionSide: positionSide,
        type: 'MARKET',
        quantity: '0',
      });
      
      if (response?.code === 0) {
        console.log(`✅ Позиция закрыта: ${normalizedSymbol} ${positionSide}`);
        return response.data;
      }
      
      console.error(`❌ Ошибка закрытия:`, response);
      return null;
    } catch (error) {
      console.error('❌ closePosition error:', error.message);
      return null;
    }
  }

  async cancelOrder(symbol, orderId) {
    try {
      const normalizedSymbol = symbol.replace(/_/g, '-');
      
      const response = await this._request('POST', '/openApi/swap/v2/trade/cancel', {}, {
        symbol: normalizedSymbol,
        orderId: orderId,
      });
      
      if (response?.code === 0) {
        console.log(`✅ Ордер отменён: ${orderId}`);
        return response.data;
      }
      
      console.error(`❌ Ошибка отмены:`, response);
      return null;
    } catch (error) {
      console.error('❌ cancelOrder error:', error.message);
      return null;
    }
  }

  async setLeverage(symbol, leverage) {
    try {
      const response = await this._request('POST', '/openApi/swap/v2/trade/leverage', {}, {
        symbol: symbol.replace(/_/g, '-'),
        leverage: leverage.toString(),
      });
      
      if (response?.code === 0) {
        console.log(`✅ Леверидж установлен: ${symbol} x${leverage}`);
        return true;
      }
      
      console.error(`❌ Ошибка левериджа:`, response);
      return false;
    } catch (error) {
      console.error('❌ setLeverage error:', error.message);
      return false;
    }
  }

  async testCredentials() {
    try {
      const balance = await this.getBalance();
      return balance !== null && balance !== undefined && balance > 0;
    } catch (error) {
      console.error('❌ testCredentials error:', error.message);
      return false;
    }
  }
}

module.exports = BingXExchange;