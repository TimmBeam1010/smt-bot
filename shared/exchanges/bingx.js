// ============================================
//  BINGX EXCHANGE CLIENT (ПО ДОКУМЕНТАЦИИ)
// ============================================

const crypto = require('crypto');

class BingXExchange {
  constructor(apiKey, secretKey, baseUrl = 'https://open-api.bingx.com') {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = baseUrl;
  }

  // ============================================
  //  ПОДПИСЬ ЗАПРОСА (HEX, СОРТИРОВКА ПО АЛФАВИТУ)
  // ============================================
  _sign(params) {
    const sortedKeys = Object.keys(params).sort();
    let queryString = '';
    for (const key of sortedKeys) {
      const value = params[key];
      if (value !== undefined && value !== null && value !== '') {
        if (queryString) queryString += '&';
        queryString += `${key}=${value}`;
      }
    }
    const signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(queryString)
      .digest('hex');
    
    return { queryString, signature };
  }

  // ============================================
  //  POST ЗАПРОСЫ (ПОДПИСЬ ТОЛЬКО ИЗ QUERY STRING)
  // ============================================
  async _signedPost(endpoint, params = {}) {
    const timestamp = Date.now();
    
    // 1. Подпись ТОЛЬКО из параметров строки запроса
    const queryParams = { timestamp };
    const { queryString, signature } = this._sign(queryParams);
    
    // 2. URL: параметры подписи в query string
    const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;
    
    // 3. Тело: параметры ордера
    const bodyParams = { ...params };
    
    console.log(`📤 POST URL: ${url}`);
    console.log(`📤 BODY:`, JSON.stringify(bodyParams, null, 2));
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-BX-APIKEY': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyParams),
    });
    
    const data = await response.json();
    console.log(`📥 ОТВЕТ БИРЖИ:`, JSON.stringify(data, null, 2));
    
    if (data.code !== 0) {
      console.error(`❌ Ошибка:`, JSON.stringify(data, null, 2));
    }
    return data;
  }

  // ============================================
  //  GET ЗАПРОСЫ (ПОДПИСЬ ИЗ ВСЕХ ПАРАМЕТРОВ)
  // ============================================
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
    console.log(`📥 ОТВЕТ БИРЖИ:`, JSON.stringify(data, null, 2));
    
    if (data.code !== 0) {
      console.error(`❌ Ошибка:`, JSON.stringify(data, null, 2));
    }
    return data;
  }

  // ============================================
  //  ПОЛУЧЕНИЕ БАЛАНСА
  // ============================================
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

  // ============================================
  //  ПОЛУЧЕНИЕ ПОЗИЦИЙ
  // ============================================
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

  // ============================================
  //  ПОЛУЧЕНИЕ КОНТРАКТОВ
  // ============================================
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

  // ============================================
  //  ПОЛУЧЕНИЕ СВЕЧЕЙ
  // ============================================
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

  // ============================================
  //  РАЗМЕЩЕНИЕ ОРДЕРА (ПО ДОКУМЕНТАЦИИ)
  // ============================================
  async placeOrder(params) {
    try {
      const {
        symbol,
        side,
        type = 'MARKET',
        quantity,
        price = null,
      } = params;

      const symbolFormatted = symbol.replace('_', '-');
      
      const orderParams = {
        symbol: symbolFormatted,
        side: side,
        type: type,
        quantity: quantity.toString(),
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
  //  ЗАКРЫТИЕ ПОЗИЦИИ
  // ============================================
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

  // ============================================
  //  ПРОВЕРКА КЛЮЧЕЙ
  // ============================================
  async testCredentials() {
    const balance = await this.getBalance();
    return balance !== null && balance !== undefined;
  }
}

module.exports = BingXExchange;