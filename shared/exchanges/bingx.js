const crypto = require('crypto');

class BingX {
  constructor(apiKey, secretKey) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = 'https://open-api.bingx.com';
  }

  // Универсальный метод для подписанных POST-запросов (BingX V3)
  async _signedRequest(endpoint, params = {}, method = 'POST') {
    const timestamp = Date.now();
    const allParams = { ...params, timestamp };

    // Сортируем ключи для подписи
    const sortedKeys = Object.keys(allParams).sort();
    const queryString = sortedKeys
      .map(key => `${key}=${allParams[key]}`)
      .join('&');

    // Генерируем подпись
    const signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(queryString)
      .digest('hex');

    const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;

    // Для BingX V3 — тело должно быть пустым, все параметры в URL
    const response = await fetch(url, {
      method,
      headers: {
        'X-BX-APIKEY': this.apiKey,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    // Логируем ошибки биржи
    if (data.code !== undefined && data.code !== 0) {
      console.error(`❌ BingX API Error [${data.code}]: ${data.msg || 'Unknown error'}`);
      console.error(`📡 URL: ${url}`);
    }

    return data;
  }

  // --- ОТКРЫТИЕ ОРДЕРА (V3) ---
  async placeOrder(params) {
    try {
      const {
        symbol,
        side,
        type = 'MARKET',
        quantity,
        leverage = 10,
        positionSide = side === 'BUY' ? 'LONG' : 'SHORT',
        stopLoss = null,
        takeProfit = null,
      } = params;

      // Форматируем символ (BONK-USDT → BONK-USDT)
      const symbolFormatted = symbol.replace('_', '-');

      const orderParams = {
        symbol: symbolFormatted,
        side: side.toUpperCase(),
        positionSide: positionSide.toUpperCase(),
        type: type.toUpperCase(),
        quantity: quantity.toString(),
        leverage: leverage.toString(),
      };

      // Добавляем SL/TP если указаны
      if (stopLoss) orderParams.stopLoss = stopLoss.toString();
      if (takeProfit) orderParams.takeProfit = takeProfit.toString();

      const response = await this._signedRequest(
        '/openApi/swap/v3/trade/order',
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

  // --- ЗАКРЫТИЕ ПОЗИЦИИ ---
  async closePosition(symbol, positionSide) {
    try {
      const response = await this._signedRequest(
        '/openApi/swap/v3/trade/closePosition',
        {
          symbol: symbol.replace('_', '-'),
          positionSide: positionSide.toUpperCase(),
        },
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

  // --- БАЛАНС ---
  async getBalance() {
    try {
      const response = await this._signedRequest(
        '/openApi/swap/v3/user/balance',
        {},
        'POST'
      );

      if (response.code === 0 && response.data?.balances) {
        const usdtBalance = response.data.balances.find(b => b.asset === 'USDT');
        return parseFloat(usdtBalance?.balance || 0);
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
      const response = await this._signedRequest(
        '/openApi/swap/v3/user/positions',
        {},
        'POST'
      );

      if (response.code === 0 && response.data) {
        // BingX возвращает массив позиций
        return response.data;
      }

      console.error(`❌ Ошибка getPositions (${response.code}): ${response.msg}`);
      return [];
    } catch (error) {
      console.error(`❌ Исключение getPositions: ${error.message}`);
      return [];
    }
  }

  // --- СВЕЧИ (V3) ---
  async getCandles({ symbol, interval = '5m', limit = 100 }) {
    try {
      const params = {
        symbol: symbol.replace('_', '-'),
        interval,
        limit: limit.toString(),
      };

      // Для GET-запросов используем отдельный метод
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

      const url = `${this.baseUrl}/openApi/swap/v3/quote/klines?${queryString}&signature=${signature}`;

      const response = await fetch(url, {
        headers: {
          'X-BX-APIKEY': this.apiKey,
        },
      });

      const data = await response.json();

      if (data.code === 0 && data.data) {
        return data.data.map(candle => ({
          time: candle[0],
          open: parseFloat(candle[1]),
          high: parseFloat(candle[2]),
          low: parseFloat(candle[3]),
          close: parseFloat(candle[4]),
          volume: parseFloat(candle[5]),
        }));
      }

      console.error(`❌ Ошибка getCandles (${data.code}): ${data.msg}`);
      return [];
    } catch (error) {
      console.error(`❌ Исключение getCandles: ${error.message}`);
      return [];
    }
  }
}

module.exports = { BingX };