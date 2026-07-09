// ============================================
//  BINGX EXCHANGE CLIENT (V2)
//  САМОИСЦЕЛЯЮЩАЯСЯ ВЕРСИЯ
//  Создаёт symbol-config-generated.js при первом запуске
// ============================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// --- АВТО-ГЕНЕРАЦИЯ КОНФИГА, ЕСЛИ ОН ОТСУТСТВУЕТ ---
const CONFIG_PATH = path.join(__dirname, 'symbol-config-generated.js');

if (!fs.existsSync(CONFIG_PATH)) {
  console.log('🔧 symbol-config-generated.js не найден, создаём...');
  
  const fallbackConfig = {
    'SOL-USDT': { precision: 3, minQty: 0.01 },
    'XRP-USDT': { precision: 3, minQty: 0.01 },
    'ETH-USDT': { precision: 3, minQty: 0.001 },
    'BTC-USDT': { precision: 3, minQty: 0.001 },
    'BNB-USDT': { precision: 3, minQty: 0.01 },
    'ADA-USDT': { precision: 2, minQty: 1 },
    'DOGE-USDT': { precision: 2, minQty: 1 },
    'DOT-USDT': { precision: 2, minQty: 0.1 },
    'LTC-USDT': { precision: 2, minQty: 0.01 },
    'LINK-USDT': { precision: 2, minQty: 0.01 },
    'UNI-USDT': { precision: 2, minQty: 0.01 },
    'ATOM-USDT': { precision: 2, minQty: 0.01 },
    'AVAX-USDT': { precision: 2, minQty: 0.01 },
    'MATIC-USDT': { precision: 2, minQty: 1 },
    'NEAR-USDT': { precision: 2, minQty: 0.01 },
    'FIL-USDT': { precision: 2, minQty: 0.01 },
    'AAVE-USDT': { precision: 2, minQty: 0.01 },
    'VET-USDT': { precision: 2, minQty: 1 },
    'TRX-USDT': { precision: 2, minQty: 1 },
    'XLM-USDT': { precision: 2, minQty: 1 },
    'ALGO-USDT': { precision: 2, minQty: 1 },
    'EGLD-USDT': { precision: 2, minQty: 0.01 },
    'HBAR-USDT': { precision: 2, minQty: 1 },
    'KAVA-USDT': { precision: 2, minQty: 0.1 },
    'KSM-USDT': { precision: 2, minQty: 0.01 },
    'MKR-USDT': { precision: 2, minQty: 0.001 },
    'ZEC-USDT': { precision: 2, minQty: 0.01 },
    'XMR-USDT': { precision: 2, minQty: 0.01 },
    'DASH-USDT': { precision: 2, minQty: 0.01 },
    'YFI-USDT': { precision: 2, minQty: 0.001 },
    'COMP-USDT': { precision: 2, minQty: 0.01 },
    'GRT-USDT': { precision: 2, minQty: 1 },
    'SNX-USDT': { precision: 2, minQty: 0.1 },
    'CRV-USDT': { precision: 2, minQty: 1 },
    '1INCH-USDT': { precision: 2, minQty: 1 },
    'ENJ-USDT': { precision: 2, minQty: 1 },
    'MANA-USDT': { precision: 2, minQty: 1 },
    'SAND-USDT': { precision: 2, minQty: 1 },
    'AXS-USDT': { precision: 2, minQty: 0.01 },
    'GALA-USDT': { precision: 2, minQty: 1 },
    'APE-USDT': { precision: 2, minQty: 0.01 },
    'OP-USDT': { precision: 2, minQty: 0.01 },
    'ARB-USDT': { precision: 2, minQty: 0.01 },
    'INJ-USDT': { precision: 2, minQty: 0.01 },
    'SEI-USDT': { precision: 2, minQty: 0.01 },
    'SUI-USDT': { precision: 2, minQty: 0.01 },
    'APT-USDT': { precision: 2, minQty: 0.01 },
    'LDO-USDT': { precision: 2, minQty: 0.01 },
    'RUNE-USDT': { precision: 2, minQty: 0.01 },
    'FLOW-USDT': { precision: 2, minQty: 0.01 },
    'STX-USDT': { precision: 2, minQty: 0.01 },
    'AR-USDT': { precision: 2, minQty: 0.01 },
    'ENS-USDT': { precision: 2, minQty: 0.01 },
    'BAT-USDT': { precision: 1, minQty: 23.6 },
    'STORJ-USDT': { precision: 2, minQty: 0.1 },
    'IMX-USDT': { precision: 2, minQty: 0.01 },
    'ZRX-USDT': { precision: 2, minQty: 1 },
    'SKL-USDT': { precision: 2, minQty: 1 },
    'SUSHI-USDT': { precision: 2, minQty: 0.1 },
    'YGG-USDT': { precision: 2, minQty: 0.01 },
    'RSR-USDT': { precision: 2, minQty: 1 },
    'KNC-USDT': { precision: 2, minQty: 0.1 },
    'GMT-USDT': { precision: 2, minQty: 0.01 },
    'ROSE-USDT': { precision: 2, minQty: 1 },
    'MINA-USDT': { precision: 2, minQty: 0.01 },
    'CFX-USDT': { precision: 0, minQty: 48 },
    'API3-USDT': { precision: 2, minQty: 0.01 },
    'AGLD-USDT': { precision: 2, minQty: 0.01 },
    'SLP-USDT': { precision: 2, minQty: 1 },
    'JASMY-USDT': { precision: 2, minQty: 1 },
    'CTK-USDT': { precision: 2, minQty: 0.01 },
    'MTL-USDT': { precision: 2, minQty: 0.01 },
    'PEOPLE-USDT': { precision: 2, minQty: 1 },
    'ANKR-USDT': { precision: 2, minQty: 1 },
    'WOO-USDT': { precision: 2, minQty: 0.01 },
    'CRO-USDT': { precision: 2, minQty: 1 },
    'LUNC-USDT': { precision: 2, minQty: 1 },
    'LUNA-USDT': { precision: 2, minQty: 0.01 },
    'QNT-USDT': { precision: 2, minQty: 0.01 },
    'ARPA-USDT': { precision: 2, minQty: 1 },
    'SFP-USDT': { precision: 2, minQty: 0.01 },
    'MAGIC-USDT': { precision: 2, minQty: 0.01 },
    'FET-USDT': { precision: 2, minQty: 0.01 },
    'GMX-USDT': { precision: 2, minQty: 0.01 },
    'COTI-USDT': { precision: 2, minQty: 0.01 },
    'METIS-USDT': { precision: 2, minQty: 0.01 },
    'ASTR-USDT': { precision: 2, minQty: 0.01 },
    'DUSK-USDT': { precision: 2, minQty: 0.01 },
    'BLUR-USDT': { precision: 2, minQty: 1 },
    'ACH-USDT': { precision: 2, minQty: 1 },
    'TRB-USDT': { precision: 2, minQty: 0.01 },
    'FLOKI-USDT': { precision: 2, minQty: 1 },
    'ILV-USDT': { precision: 2, minQty: 0.01 },
    'ZEN-USDT': { precision: 2, minQty: 0.01 },
    'SCRT-USDT': { precision: 2, minQty: 0.01 },
    'RLC-USDT': { precision: 2, minQty: 0.01 },
    'LPT-USDT': { precision: 2, minQty: 0.01 },
    'CKB-USDT': { precision: 2, minQty: 1 },
    'QTUM-USDT': { precision: 2, minQty: 0.01 },
    'SUN-USDT': { precision: 2, minQty: 1 },
    'IOTA-USDT': { precision: 2, minQty: 1 },
    'SSV-USDT': { precision: 2, minQty: 0.01 },
    'BICO-USDT': { precision: 2, minQty: 0.01 },
    'TLM-USDT': { precision: 2, minQty: 1 },
    'XCN-USDT': { precision: 2, minQty: 1 },
    'TWT-USDT': { precision: 2, minQty: 0.01 },
    'LQTY-USDT': { precision: 2, minQty: 0.01 },
    'ID-USDT': { precision: 2, minQty: 0.01 },
    'EDU-USDT': { precision: 2, minQty: 0.01 },
    'TURBO-USDT': { precision: 2, minQty: 1 },
    'ORDI-USDT': { precision: 2, minQty: 0.01 },
    'UMA-USDT': { precision: 2, minQty: 0.01 },
    'OKB-USDT': { precision: 2, minQty: 0.01 },
    'NMR-USDT': { precision: 2, minQty: 0.01 },
    'MAV-USDT': { precision: 2, minQty: 0.01 },
    'WLD-USDT': { precision: 2, minQty: 0.01 },
    'PENDLE-USDT': { precision: 2, minQty: 0.01 },
    'ARKM-USDT': { precision: 2, minQty: 0.01 },
    'CYBER-USDT': { precision: 2, minQty: 0.01 },
    '1000PEPE-USDT': { precision: 2, minQty: 1 },
    'KAS-USDT': { precision: 0, minQty: 68 },
    'Q-USDT': { precision: 0, minQty: 101 },
    'ORDER-USDT': { precision: 2, minQty: 59.37 },
    'FLUX-USDT': { precision: 2, minQty: 0.01 },
    'SYN-USDT': { precision: 2, minQty: 0.01 },
    'WIF-USDT': { precision: 2, minQty: 0.01 },
    'PI-USDT': { precision: 3, minQty: 0.01 },
    'FLOCK-USDT': { precision: 3, minQty: 0.01 },
  };

  const fileContent = `// Автоматически сгенерированный fallback-конфиг
const SYMBOL_CONFIG = ${JSON.stringify(fallbackConfig, null, 2)};
module.exports = { SYMBOL_CONFIG };`;

  fs.writeFileSync(CONFIG_PATH, fileContent, 'utf8');
  console.log('✅ symbol-config-generated.js создан с fallback-параметрами');
}

// --- ПОДКЛЮЧАЕМ СГЕНЕРИРОВАННЫЙ КОНФИГ ---
const { getSymbolConfig } = require('./symbol-config-generated');

// --- ОСНОВНОЙ КЛАСС ---
class BingX {
  constructor(apiKey, secretKey) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = 'https://open-api.bingx.com';
  }

  async _signedRequest(endpoint, params = {}, method = 'GET') {
    delete params.stopLoss;
    delete params.takeProfit;
    delete params.leverage;
    delete params.positionSide;

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
      const factor = Math.pow(10, precision);
      let roundedQuantity = Math.round(quantity * factor) / factor;

      const minQty = config.minQty;
      if (minQty > 0 && roundedQuantity < minQty) {
        console.warn(`⚠️ Количество ${roundedQuantity} меньше минимального ${minQty} для ${symbol}, устанавливаем минимум`);
        roundedQuantity = minQty;
      }

      if (roundedQuantity <= 0) {
        console.warn(`⚠️ Quantity = ${roundedQuantity}, пропускаем ордер для ${symbol}`);
        return null;
      }

      const orderParams = {
        symbol: symbol.replace(/_/g, '-'),
        side: side.toUpperCase() === 'LONG' ? 'BUY' : 'SELL',
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