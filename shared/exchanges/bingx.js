const crypto = require('crypto');

class BingX {
  constructor(apiKey, secretKey) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = 'https://open-api.bingx.com';
  }

  async _signedPost(endpoint, params = {}) {
    const timestamp = Date.now();
    const paramsWithTime = { ...params, timestamp };
    
    // Сортировка ключей для подписи
    const sortedKeys = Object.keys(paramsWithTime).sort();
    const queryString = sortedKeys
      .map(key => `${key}=${paramsWithTime[key]}`)
      .join('&');
    
    const signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(queryString)
      .digest('hex');
    
    const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-BX-APIKEY': this.apiKey,
        'Content-Type': 'application/json',
      },
    });
    
    return response.json();
  }

  async placeOrder(params) {
    try {
      const {
        symbol,
        side,
        type = 'MARKET',
        quantity,
        price = null,
        leverage = 10,
        positionSide = side === 'BUY' ? 'LONG' : 'SHORT',
      } = params;

      const symbolFormatted = symbol.replace('_', '-');
      const orderParams = {
        symbol: symbolFormatted,
        side: side,
        positionSide: positionSide,
        type: type,
        quantity: quantity.toString(),
        leverage: leverage.toString(),
      };
      
      if (price) orderParams.price = price.toString();

      const response = await this._signedPost('/openApi/swap/v2/trade/order', orderParams);
      
      if (response?.code === 0) {
        console.log(`✅ Ордер открыт: ${response.data?.orderId || 'OK'}`);
        return response.data;
      }
      
      console.error(`❌ Ошибка placeOrder:`, response);
      return null;
    } catch (error) {
      console.error(`❌ Ошибка placeOrder:`, error.message);
      return null;
    }
  }

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

  async getBalance() {
    try {
      const response = await this._signedPost('/openApi/swap/v2/user/balance', {});
      if (response?.code === 0 && response.data?.balances) {
        const usdtBalance = response.data.balances.find(b => b.asset === 'USDT');
        return parseFloat(usdtBalance?.balance || 0);
      }
      console.error('❌ Ошибка getBalance:', response);
      return 0;
    } catch (error) {
      console.error('❌ Ошибка getBalance:', error.message);
      return 0;
    }
  }

  async getPositions() {
    try {
      const response = await this._signedPost('/openApi/swap/v2/user/positions', {});
      if (response?.code === 0 && response.data) {
        return response.data;
      }
      console.error('❌ Ошибка getPositions:', response);
      return [];
    } catch (error) {
      console.error('❌ Ошибка getPositions:', error.message);
      return [];
    }
  }

  async getCandles({ symbol, interval = '5m', limit = 100 }) {
    try {
      const timestamp = Date.now();
      const params = {
        symbol: symbol.replace('_', '-'),
        interval,
        limit: limit.toString(),
        timestamp: timestamp.toString()
      };
      
      const sortedKeys = Object.keys(params).sort();
      const queryString = sortedKeys
        .map(key => `${key}=${params[key]}`)
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
      if (data?.code === 0 && data.data) {
        return data.data.map(candle => ({
          time: candle[0],
          open: parseFloat(candle[1]),
          high: parseFloat(candle[2]),
          low: parseFloat(candle[3]),
          close: parseFloat(candle[4]),
          volume: parseFloat(candle[5]),
        }));
      }
      console.error('❌ Ошибка getCandles:', data);
      return [];
    } catch (error) {
      console.error('❌ Ошибка getCandles:', error.message);
      return [];
    }
  }
}

module.exports = { BingX };