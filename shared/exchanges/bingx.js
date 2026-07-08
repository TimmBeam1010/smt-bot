// ============================================
//  BINGX EXCHANGE CLIENT - ИСПРАВЛЕННАЯ ВЕРСИЯ
// ============================================

const crypto = require('crypto');

class BingXExchange {
  constructor(apiKey, secretKey, baseUrl = 'https://open-api.bingx.com') {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = baseUrl;
  }

  _sign(params) {
    // 1. СОРТИРУЕМ КЛЮЧИ ПО АЛФАВИТУ
    const sortedKeys = Object.keys(params).sort();
    let queryString = '';
    for (const key of sortedKeys) {
      if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
        if (queryString) queryString += '&';
        queryString += `${key}=${params[key]}`;
      }
    }
    // 2. ПОДПИСЬ В HEX
    return crypto.createHmac('sha256', this.secretKey).update(queryString).digest('hex');
  }

  async _request(method, endpoint, params = {}, body = null) {
    const timestamp = Date.now();
    
    // 3. ФОРМИРУЕМ ТЕЛО ЗАПРОСА (ВСЕГДА С TIMESTAMP)
    const requestBody = { 
      ...body, 
      timestamp: timestamp 
    };
    
    // 4. УДАЛЯЕМ undefined/null ПОЛЯ
    const cleanBody = {};
    for (const key of Object.keys(requestBody)) {
      if (requestBody[key] !== undefined && requestBody[key] !== null) {
        cleanBody[key] = requestBody[key];
      }
    }
    
    // 5. ПОДПИСЬ ОТ СОРТИРОВАННЫХ КЛЮЧЕЙ ТЕЛА
    const sortedKeys = Object.keys(cleanBody).sort();
    const queryString = sortedKeys
      .map(key => `${key}=${cleanBody[key]}`)
      .join('&');
    
    const signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(queryString)
      .digest('hex');
    
    // 6. ДОБАВЛЯЕМ ПОДПИСЬ В ТЕЛО
    cleanBody.signature = signature;
    
    // 7. URL: ТОЛЬКО ЭНДПОИНТ (БЕЗ ПАРАМЕТРОВ)
    const url = `${this.baseUrl}${endpoint}`;
    
    console.log(`📤 ${method} URL: ${url}`);
    console.log(`📤 BODY:`, JSON.stringify(cleanBody, null, 2));
    
    const options = {
      method: method,
      headers: {
        'X-BX-APIKEY': this.apiKey,
        'Content-Type': 'application/json',
      },
    };
    
    // 8. ДЛЯ POST ВСЕГДА ДОБАВЛЯЕМ BODY
    if (method === 'POST') {
      options.body = JSON.stringify(cleanBody);
    }
    
    try {
      const response = await fetch(url, options);
      const data = await response.json();
      console.log(`📥 ОТВЕТ:`, JSON.stringify(data, null, 2));
      return data;
    } catch (error) {
      console.error(`❌ Request error:`, error.message);
      throw error;
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
      const { symbol, side, type = 'MARKET', quantity, price = null, positionSide = null } = params;
      
      // НОРМАЛИЗУЕМ SYMBOL
      const normalizedSymbol = symbol.replace(/_/g, '-');
      
      const orderData = {
        symbol: normalizedSymbol,
        side: side.toUpperCase(),
        type: type.toUpperCase(),
        quantity: quantity.toString(),
      };
      
      // ДОБАВЛЯЕМ POSITIONSIDE ДЛЯ ЗАКРЫТИЯ ПОЗИЦИЙ
      if (positionSide) {
        orderData.positionSide = positionSide;
      }
      
      // ДОБАВЛЯЕМ PRICE ДЛЯ ЛИМИТНЫХ ОРДЕРОВ
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

  async getKlines(symbol, interval = '5m', limit = 100) {
    return this.getCandles(symbol, interval, limit);
  }

  async testCredentials() {
    try {
      const balance = await this.getBalance();
      return balance !== null && balance !== undefined;
    } catch (error) {
      console.error('❌ testCredentials error:', error.message);
      return false;
    }
  }

  // ДОПОЛНИТЕЛЬНЫЙ МЕТОД ДЛЯ ЛЕВЕРИДЖА
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
      
      console.error(`❌ Ошибка установки левериджа:`, response);
      return false;
    } catch (error) {
      console.error('❌ setLeverage error:', error.message);
      return false;
    }
  }
}

module.exports = BingXExchange;