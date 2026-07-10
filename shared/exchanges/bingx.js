// ============================================
//  BINGX EXCHANGE CLIENT (ЧЕРЕЗ БИБЛИОТЕКУ)
// ============================================

const { BingxApiClient } = require('bingx-api');

class BingX {
  constructor(apiKey, secretKey) {
    this.client = new BingxApiClient({
      apiKey: apiKey,
      apiSecret: secretKey,
    });
    this.apiKey = apiKey;
    this.secretKey = secretKey;
  }

  async getBalance() {
    try {
      const result = await this.client.accountService.getBalance();
      if (result.code === 0 && result.data) {
        const usdt = result.data.balances.find(b => b.asset === 'USDT');
        return parseFloat(usdt?.balance || 0);
      }
      return 0;
    } catch (error) {
      console.error('❌ Ошибка getBalance:', error.message);
      return 0;
    }
  }

  async placeOrder(params) {
    try {
      const { symbol, side, type = 'MARKET', quantity } = params;
      const orderParams = {
        symbol: symbol.replace(/_/g, '-'),
        side: side === 'LONG' ? 'BUY' : 'SELL',
        type: type.toUpperCase(),
        quantity: quantity.toString(),
      };
      const result = await this.client.tradeService.placeOrder(orderParams);
      if (result.code === 0) {
        console.log(`✅ Ордер открыт: ${result.data?.orderId}`);
        return result.data;
      }
      console.error(`❌ Ошибка placeOrder: ${result.msg}`);
      return null;
    } catch (error) {
      console.error('❌ Исключение placeOrder:', error.message);
      return null;
    }
  }

  // ... остальные методы (getPositions, closePosition, getCandles) можно добавить аналогично
}

module.exports = { BingX };