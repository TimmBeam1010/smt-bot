// ============================================
//  EXCHANGE FACTORY
//  Точка входа для всех бирж
// ============================================

const BingX = require('./bingx');

/**
 * Фабрика для создания клиентов бирж
 * @param {string} exchange - Название биржи ('bingx')
 * @param {string} apiKey - API ключ
 * @param {string} secretKey - Секретный ключ
 * @returns {object} - Экземпляр клиента биржи
 */
function getExchange(exchange, apiKey, secretKey) {
  switch (exchange.toLowerCase()) {
    case 'bingx':
      return new BingX(apiKey, secretKey);
    default:
      throw new Error(`Unsupported exchange: ${exchange}`);
  }
}

module.exports = { getExchange };