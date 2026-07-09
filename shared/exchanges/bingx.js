const crypto = require('crypto');

class BingX {
  constructor(apiKey, secretKey) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = 'https://open-api.bingx.com';
    this.contractsCache = {};
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

  // --- ПОЛУЧЕНИЕ СПИСКА КОНТРАКТОВ (V2) ---
  async getContracts() {
    try {
      const response = await fetch(`${this.baseUrl}/openApi/swap/v2/quote/contracts`, {
        headers: {
          'X-BX-APIKEY': this.apiKey,
        },
      });
      const data = await response.json();
      if (data.code === 0 && data.data) {
        // Сохраняем в кеш для быстрого доступа
        for (const contract of data.data) {
          this.contractsCache[contract.symbol] = contract;
        }
        return data.data;
      }
      console.error('❌ Ошибка getContracts:', data);
      return [];
    } catch (error) {
      console.error('❌ Исключение getContracts:', error.message);
      return [];
    }
  }

  // --- ПОЛУЧЕНИЕ ИНФОРМАЦИИ О КОНТРАКТЕ (с точностью) ---
  async getContractInfo(symbol) {
    try {
      // Проверяем кеш
      if (this.contractsCache[symbol]) {
        return this.contractsCache[symbol];
      }

      // Если нет в кеше — запрашиваем
      const response = await fetch(`${this.baseUrl}/openApi/swap/v2/quote/contracts?symbol=${symbol}`, {
        headers: {
          'X-BX-APIKEY': this.apiKey,
        },
      });
      const data = await response.json();
      if (data.code === 0 && data.data && data.data.length > 0) {
        this.contractsCache[symbol] = data.data[0];
        return data.data[0];
      }
      console.error('❌ Ошибка getContractInfo:', data);
      return null;
    } catch (error) {
      console.error('❌ Исключение getContractInfo:', error.message);
      return null;
    }
  }

  // --- ОКРУГЛЕНИЕ КОЛИЧЕСТВА С УЧЁТОМ ТОЧНОСТИ ---
  async roundQuantity(symbol, quantity) {
    try {
      const contract = await this.getContractInfo(symbol);
      if (contract && contract.quantityPrecision !== undefined) {
        const precision = contract.quantityPrecision;
        const factor = Math.pow(10, precision);
        return Math.round(quantity * factor) / factor;
      }
      // Если не удалось получить точность — округляем до 3 знаков
      return Math.round(quantity * 1000) / 1000;
    } catch (error) {
      console.error('❌ Ошибка roundQuantity:', error.message);
      return Math.round(quantity * 1000) / 1000;
    }
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

      // Округляем количество с учётом точности символа
      const roundedQuantity = await this.roundQuantity(symbol, quantity);

      if (roundedQuantity <= 0) {
        console.warn('⚠️ Quantity = 0, пропускаем ордер');
        return null;
      }

      const orderParams = {
        symbol: symbol.replace(/_/g, '-'),
        side: side === 'LONG' ? 'BUY' : 'SELL',
        type: type.toUpperCase(),
        quantity: roundedQuantity.toString(),
      };

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
        // BingX V2 возвращает массив объектов
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