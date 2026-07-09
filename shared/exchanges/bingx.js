const crypto = require('crypto');

class BingX {
  constructor(apiKey, secretKey) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = 'https://open-api.bingx.com';
  }

  // Универсальный метод для подписанных запросов (V2)
  async _signedRequest(endpoint, params = {}, method = 'GET') {
    delete params.stopLoss;
    delete params.takeProfit;
    delete params.leverage;

    const timestamp = Date.now();
    const allParams = { ...params, timestamp };

    const sortedKeys = Object.keys(allParams).sort();
    const queryString = sortedKeys
      .map(key => `${key}=${allParams[key]}`)
      .join('&');

    const signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(queryString)
      .digest('hex');

    const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;

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

  // --- БАЛАНС (V2 - GET) ---
  async getBalance() {
    try {
      const response = await this._signedRequest(
        '/openApi/swap/v2/user/balance',
        {},
        'GET'
      );

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

  // --- ПОЗИЦИИ (V2 - GET) ---
  async getPositions() {
    try {
      const response = await this._signedRequest(
        '/openApi/swap/v2/user/positions',
        {},
        'GET'
      );

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

  // --- ОТКРЫТИЕ ОРДЕРА (V2 - MARKET) ---
  async placeOrder(params) {
    try {
      const {
        symbol,
        side,
        type = 'MARKET',
        quantity,
      } = params;

      // Правильный формат: BONK_USDT → BONK-USDT
      const formattedSymbol = symbol.replace(/_/g, '-');

      const orderParams = {
        symbol: formattedSymbol,
        side: side === 'LONG' ? 'BUY' : 'SELL',
        positionSide: (side === 'LONG' ? 'LONG' : 'SHORT').toUpperCase(),
        type: type.toUpperCase(),
        quantity: quantity.toString(),
      };

      if (parseFloat(orderParams.quantity) <= 0) {
        console.warn('⚠️ Quantity = 0, пропускаем ордер');
        return null;
      }

      console.log('📤 Отправка ордера:', JSON.stringify(orderParams, null, 2));

      const response = await this._signedRequest(
        '/openApi/swap/v2/trade/order',
        orderParams,
        'POST'
      );

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

  // --- ЗАКРЫТИЕ ПОЗИЦИИ (V2 - POST) ---
  async closePosition(symbol, positionSide) {
    try {
      const params = {
        symbol: symbol.replace(/_/g, '-'),
        positionSide: positionSide.toUpperCase(),
      };

      const response = await this._signedRequest(
        '/openApi/swap/v2/trade/closePosition',
        params,
        'POST'
      );

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

  // --- СВЕЧИ (V2 - GET) ---
  async getCandles({ symbol, interval = '5m', limit = 100 }) {
    try {
      const params = {
        symbol: symbol.replace(/_/g, '-'),
        interval,
        limit: limit.toString(),
      };

      const response = await this._signedRequest(
        '/openApi/swap/v2/quote/klines',
        params,
        'GET'
      );

      if (response.code === 0 && response.data) {
        return response.data.map(candle => ({
          time: candle[0],
          open: parseFloat(candle[1]),
          high: parseFloat(candle[2]),
          low: parseFloat(candle[3]),
          close: parseFloat(candle[4]),
          volume: parseFloat(candle[5]),
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