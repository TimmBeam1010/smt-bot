// ============================================
//  BINGX EXCHANGE CLIENT (V2)
//  ИСПРАВЛЕННАЯ ПОДПИСЬ (TIMESTAMP В КОНЦЕ)
// ============================================

const crypto = require('crypto');
const { getSymbolConfig } = require('../../shared/symbol-config');

class BingX {
  constructor(apiKey, secretKey) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = 'https://open-api.bingx.com';
  }

  // --- ПОЛУЧЕНИЕ СЕРВЕРНОГО ВРЕМЕНИ ---
  async _getServerTime() {
    try {
      const response = await fetch(`${this.baseUrl}/openApi/swap/v2/quote/time`);
      const data = await response.json();
      if (data.timestamp) {
        return data.timestamp;
      }
    } catch (error) {
      console.error('❌ Ошибка получения серверного времени:', error.message);
    }
    return Date.now();
  }

  // --- ПОДПИСАННЫЙ ЗАПРОС (TIMESTAMP В КОНЦЕ) ---
  async _signedRequest(endpoint, params = {}, method = 'GET') {
    delete params.stopLoss;
    delete params.takeProfit;
    delete params.leverage;

    const timestamp = await this._getServerTime();

    // Сортируем только параметры (без timestamp)
    const sortedKeys = Object.keys(params).sort();
    const queryString = sortedKeys
      .map(key => `${key}=${params[key]}`)
      .join('&');

    // Подпись: параметры + timestamp
    const signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(`${queryString}&timestamp=${timestamp}`)
      .digest('hex');

    // URL: параметры + timestamp + подпись
    const url = `${this.baseUrl}${endpoint}?${queryString}&timestamp=${timestamp}&signature=${signature}`;

    const options = {
      method,
      headers: {
        'X-BX-APIKEY': this.apiKey,
        'Content-Type': 'application/json',
      },
    };

    const response = await fetch(url, options);
    const data = await response.json();

    if (data.code !== undefined && data.code !== 0) {
      console.error(`❌ BingX API Error [${data.code}]: ${data.msg || 'Unknown error'}`);
      console.error(`📡 URL: ${url}`);
    }

    return data;
  }

  // --- ПОЛУЧЕНИЕ СПИСКА КОНТРАКТОВ ---
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

  // --- БАЛАНС ---
  async getBalance() {
    try {
      const response = await this._signedRequest('/openApi/swap/v2/user/balance', {}, 'GET');
      if (response.code === 0 && response.data && response.data.balance) {
        const balanceObj = response.data.balance;
        const balance = parseFloat(balanceObj.availableMargin || balanceObj.balance || 0);
        console.log(`💰 Баланс USDT: ${balance}`);
        return balance;
      }
      console.error(`❌ Ошибка getBalance (${response.code}): ${response.msg}`);
      return 0;
    } catch (error) {
      console.error(`❌ Исключение getBalance: ${error.message}`);
      return 0;
    }
  }

  // --- ПОЗИЦИИ ---
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

  // --- ОТКРЫТИЕ ОРДЕРА ---
  async placeOrder(params) {
    try {
      const { symbol, side, type = 'MARKET', quantity } = params;

      const config = getSymbolConfig(symbol);
      const precision = config.precision;
      const minQty = config.minQty || 0;

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
      };
      const mappedSide = sideMap[side.toUpperCase()] || side.toUpperCase();

      const orderParams = {
        symbol: symbol.replace(/_/g, '-'),
        side: mappedSide,
        type: type.toUpperCase(),
        quantity: roundedQuantity.toString(),
      };

      console.log('📤 Отправка ордера (V2):', JSON.stringify(orderParams, null, 2));

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

  // --- ЗАКРЫТИЕ ПОЗИЦИИ ---
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

  // --- СВЕЧИ ---
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