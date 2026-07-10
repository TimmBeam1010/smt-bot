/**
 * Exchange Factory
 * Создает клиентов для разных бирж
 */

const { BingX } = require('./bingx');

// Кэш клиентов
const clients = new Map();

/**
 * Создать или получить клиент для биржи
 * Поддерживает оба формата:
 *   - getExchange('bingx', { apiKey, secretKey })
 *   - getExchange('bingx', apiKey, secretKey) — старый формат
 */
function getExchange(exchangeName, config) {
  // Поддержка старого формата: getExchange('bingx', apiKey, secretKey)
  if (typeof config === 'string') {
    const apiKey = config;
    const secretKey = arguments[2];
    config = { apiKey, secretKey };
  }

  const key = `${exchangeName}:${config.apiKey}`;

  if (clients.has(key)) {
    return clients.get(key);
  }

  const { apiKey, secretKey } = config;

  if (!apiKey || !secretKey) {
    throw new Error(`❌ API ключи не указаны для ${exchangeName}`);
  }

  let client;
  switch (exchangeName.toLowerCase()) {
    case 'bingx':
      client = new BingX(apiKey, secretKey);
      break;

    default:
      throw new Error(`❌ Неподдерживаемая биржа: ${exchangeName}`);
  }

  clients.set(key, client);
  return client;
}

/**
 * Создать клиент для биржи (алиас)
 */
function createExchangeClient(exchangeName, config) {
  return getExchange(exchangeName, config);
}

module.exports = {
  getExchange,
  createExchangeClient,
  BingX,
};