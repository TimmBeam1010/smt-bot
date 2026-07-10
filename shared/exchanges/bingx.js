// ============================================
//  BINGX EXCHANGE CLIENT (V2)
//  ИСПРАВЛЕННАЯ ВЕРСИЯ - ПРАВИЛЬНАЯ ПОДПИСЬ
// ============================================

const crypto = require('crypto');
const { getSymbolConfig } = require('../../shared/symbol-config');

class BingX {
  constructor(apiKey, secretKey) {
    if (!apiKey || !secretKey) {
      throw new Error('❌ API Key или Secret Key отсутствуют!');
    }
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = 'https://open-api.bingx.com';
    console.log('🔑 API Key загружен:', this.apiKey.substring(0, 10) + '...');
    console.log('🔐 Secret Key загружен:', this.secretKey.substring(0, 10) + '...');
  }

  async _getServerTime() {
    return Date.now();
  }

  async _signedRequest(endpoint, params = {}, method = 'POST') {
    const timestamp = await this._getServerTime();

    let signature;
    let url;

    // 1. Сортируем ключи и формируем queryString
    const sortedKeys = Object.keys(params).sort();
    const queryString = sortedKeys
      .map(key => `${key}=${params[key]}`)
      .join('&');

    // 2. Строка для подписи: queryString + timestamp
    const paramsStr = queryString ? `${queryString}&timestamp=${timestamp}` : `timestamp=${timestamp}`;

    // 3. Вычисляем подпись
    signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(paramsStr)
      .digest('hex');

    // 4. Формируем URL
    if (method === 'GET') {
      // Для GET: параметры + timestamp + signature
      const getQuery = queryString ? `${queryString}&timestamp=${timestamp}&signature=${signature}` : `timestamp=${timestamp}&signature=${signature}`;
      url = `${this.baseUrl}${endpoint}?${getQuery}`;
    } else {
      // ✅ ДЛЯ POST: В URL добавляем queryString + timestamp + signature
      const postQuery = queryString ? `${queryString}&timestamp=${timestamp}&signature=${signature}` : `timestamp=${timestamp}&signature=${signature}`;
      url = `${this.baseUrl}${endpoint}?${postQuery}`;
    }

    const body = method === 'POST' ? JSON.stringify(params) : undefined;

    console.log('📤 URL:', url);
    console.log('📦 BODY:', body || '{}');
    console.log('🔑 X-BX-APIKEY:', this.apiKey ? this.apiKey.substring(0, 10) + '...' : '❌ ОТСУТСТВУЕТ');

    const response = await fetch(url, {
      method,
      headers: {
        'X-BX-APIKEY': this.apiKey,
        'Content-Type': 'application/json',
      },
      body,
    });

    const data = await response.json();

    if (data.code !== undefined && data.code !== 0) {
      console.error(`❌ BingX API Error [${data.code}]: ${data.msg || 'Unknown error'}`);
      console.error(`📡 URL: ${url}`);
    }

    return data;
  }

  async getContracts() {
    try {
      const response = await fetch(`${this.baseUrl}/openApi/swap/v2/quote/contracts`, {
        headers: { 'X-BX-APIKEY': this.apiKey },
      });
      const data = await response.json();
      if (data.code === 0 && data.data) {
        return data.data;
      }
      console.error('❌ Ошибка getContracts:', data);
      return [];
    } catch (error) {
      console.error('❌ Исключение getContracts:', error.message);
      return [];
    }
  }

  async getBalance() {
    try {
      const response = await this._signedRequest('/openApi/swap/v2/user/balance', {}, 'GET');
      
      if (response.code === 0 && response.data) {
        let assets = response.data;
        
        // Если data — объект с полем balance (старый формат)
        if (!Array.isArray(assets) && assets.balance) {
          const balanceObj = assets.balance;
          if (balanceObj.asset === 'USDT') {
            const balance = parseFloat(balanceObj.availableMargin || balanceObj.balance || 0);
            console.log(`💰 Баланс USDT: ${balance}`);
            return balance;
          }
          for (const key of Object.keys(assets)) {
            if (assets[key] && assets[key].asset === 'USDT') {
              const balance = parseFloat(assets[key].availableMargin || assets[key].balance || 0);
              console.log(`💰 Баланс USDT: ${balance}`);
              return balance;
            }
          }
          console.log('⚠️ USDT не найден в ответе');
          return 0;
        }
        
        // Если data — массив (новый формат)
        if (Array.isArray(assets)) {
          const usdt = assets.find(a => a.asset === 'USDT');
          if (usdt) {
            const balance = parseFloat(usdt.availableMargin || usdt.equity || usdt.balance || 0);
            console.log(`💰 Баланс USDT: ${balance}`);
            return balance;
          }
          console.log('⚠️ USDT не найден в массиве');
          return 0;
        }
        
        console.log('⚠️ Неизвестный формат данных:', typeof assets);
        return 0;
      }
      
      console.error(`❌ Ошибка getBalance (${response.code}): ${response.msg}`);
      return 0;
    } catch (error) {
      console.error(`❌ Исключение getBalance: ${error.message}`);
      return 0;
    }
  }

  async getPositions() {
    try {
      const response = await this._signedRequest('/openApi/swap/v2/user/positions', {}, 'GET');
      if (response.code === 0 && response.data) {
        return response.data;
      }
      console.error(`❌ Ошибка getPositions (${response.code}): ${response.msg}`);
      return [];
    } catch (error) {
      console.error(`❌ Исключение getPositions: ${error.message}`);
      return [];
    }
  }

  async placeOrder(params) {
    try {
      const { symbol, side, type = 'MARKET', quantity, price, stopLoss, takeProfit } = params;

      const config = getSymbolConfig(symbol);
      const precision = config?.precision || 8;
      const minQty = config?.minQty || 0;

      const factor = Math.pow(10, precision);
      let roundedQuantity = Math.round(quantity * factor) / factor;

      if (minQty > 0 && roundedQuantity < minQty) {
        console.warn(`⚠️ Количество ${roundedQuantity} меньше минимального ${minQty} для ${symbol}, устанавливаем минимум`);
        roundedQuantity = minQty;
      }

      roundedQuantity = Math.round(roundedQuantity * factor) / factor;

      if (roundedQuantity <= 0) {
        console.warn(`⚠️ Quantity = ${roundedQuantity}, пропускаем ордер для ${symbol}`);
        return null;
      }

      const sideMap = {
        'LONG': 'BUY',
        'SHORT': 'SELL',
        'BUY': 'BUY',
        'SELL': 'SELL'
      };
      const mappedSide = sideMap[side.toUpperCase()] || side.toUpperCase();

      const orderParams = {
        symbol: symbol.replace(/_/g, '-'),
        side: mappedSide,
        type: type.toUpperCase(),
        quantity: roundedQuantity.toString(),
      };

      if (type.toUpperCase() === 'LIMIT' && price) {
        orderParams.price = price.toString();
      }

      if (side.toUpperCase() === 'LONG' || side.toUpperCase() === 'SHORT') {
        orderParams.positionSide = side.toUpperCase();
      }

      if (stopLoss) {
        orderParams.stopLoss = stopLoss.toString();
      }
      if (takeProfit) {
        orderParams.takeProfit = takeProfit.toString();
      }

      console.log('📤 Отправка ордера:', JSON.stringify(orderParams, null, 2));

      const response = await this._signedRequest('/openApi/swap/v2/trade/order', orderParams, 'POST');

      if (response.code === 0) {
        console.log(`✅ Ордер открыт: ${response.data?.orderId || 'OK'}`);
        return response.data;
      }

      console.error(`❌ Ошибка placeOrder (${response.code}): ${response.msg}`);
      return null;
    } catch (error) {
      console.error(`❌ Исключение placeOrder: ${error.message}`);
      return null;
    }
  }

  async closePosition(symbol, positionSide) {
    try {
      const params = {
        symbol: symbol.replace(/_/g, '-'),
        positionSide: positionSide.toUpperCase(),
      };
      const response = await this._signedRequest('/openApi/swap/v2/trade/closePosition', params, 'POST');
      if (response.code === 0) {
        console.log(`✅ Позиция закрыта: ${symbol} ${positionSide}`);
        return response.data;
      }
      console.error(`❌ Ошибка closePosition (${response.code}): ${response.msg}`);
      return null;
    } catch (error) {
      console.error(`❌ Исключение closePosition: ${error.message}`);
      return null;
    }
  }

  async getCandles({ symbol, interval = '5m', limit = 100 }) {
    try {
      const params = {
        symbol: symbol.replace(/_/g, '-'),
        interval,
        limit: limit.toString(),
      };
      const response = await this._signedRequest('/openApi/swap/v2/quote/klines', params, 'GET');
      if (response.code === 0 && response.data) {
        return response.data.map(candle => ({
          time: candle.time,
          open: parseFloat(candle.open),
          high: parseFloat(candle.high),
          low: parseFloat(candle.low),
          close: parseFloat(candle.close),
          volume: parseFloat(candle.volume),
        }));
      }
      console.error(`❌ Ошибка getCandles (${response.code}): ${response.msg}`);
      return [];
    } catch (error) {
      console.error(`❌ Исключение getCandles: ${error.message}`);
      return [];
    }
  }
}

module.exports = { BingX };