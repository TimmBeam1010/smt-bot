/**
 * Exchange Factory
 * Создает клиентов для разных бирж
 */

const { BingX } = require('./bingx');
// const { BingXWrapper } = require('./bingx-wrapper'); // ❌ ОТКЛЮЧАЕМ

/**
 * Создать клиент для биржи
 */
function createExchangeClient(exchangeName, config) {
  const { apiKey, secretKey } = config;
  
  if (!apiKey || !secretKey) {
    throw new Error(`❌ API ключи не указаны для ${exchangeName}`);
  }
  
  switch (exchangeName.toLowerCase()) {
    case 'bingx':
      // ✅ Используем НАТИВНЫЙ клиент (не обертку)
      return new BingX(apiKey, secretKey);
      
    // case 'bybit':
    //   return new ByBit(apiKey, secretKey);
      
    default:
      throw new Error(`❌ Неподдерживаемая биржа: ${exchangeName}`);
  }
}

module.exports = {
  createExchangeClient,
  BingX,
  // BingXWrapper, // ❌ ОТКЛЮЧАЕМ
};