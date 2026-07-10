// ============================================
//  BINGX EXCHANGE CLIENT (V2)
//  ИСПРАВЛЕННАЯ ПОДПИСЬ ДЛЯ GET-ЗАПРОСОВ
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

  async _signedRequest(endpoint, params = {}, method = 'POST') {
    const timestamp = await this._getServerTime();

    let signature;
    if (method === 'GET' && Object.keys(params).length === 0) {
      // Для GET-запросов без параметров (баланс, позиции)
      const paramsStr = `timestamp=${timestamp}`;
      signature = crypto
        .createHmac('sha256', this.secretKey)
        .update(paramsStr)
        .digest('hex');
      console.log('🔑 GET подпись (без параметров):', paramsStr);
    } else {
      // Для POST-запросов и GET с параметрами
      const sortedKeys = Object.keys(params).sort();
      const queryString = sortedKeys
        .map(key => `${key}=${params[key]}`)
        .join('&');
      const paramsStr = queryString ? `${queryString}&timestamp=${timestamp}` : `timestamp=${timestamp}`;
      signature = crypto
        .createHmac('sha256', this.secretKey)
        .update(paramsStr)
        .digest('hex');
      console.log('🔑 Подпись (с параметрами):', paramsStr);
    }

    const url = `${this.baseUrl}${endpoint}?timestamp=${timestamp}&signature=${signature}`;
    const body = method === 'POST' ? JSON.stringify(params) : undefined;

    console.log('📤 URL:', url);
    console.log('📦 BODY:', body || '{}');

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