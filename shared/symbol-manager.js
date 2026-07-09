// ============================================
//  МЕНЕДЖЕР СИМВОЛОВ
//  Централизованное управление характеристиками монет
// ============================================

const { getExchange } = require('./exchanges');
const cache = require('./cache');
const { logger } = require('./logger');
const log = logger('symbol-manager');

// Кеш на 10 минут
const CACHE_TTL = 10 * 60 * 1000;
const CACHE_KEY = 'symbols_info';

class SymbolManager {
  constructor() {
    this.contracts = {};
    this.lastUpdate = null;
  }

  /**
   * Загрузить все контракты с биржи
   */
  async loadContracts(exchange, apiKey, secretKey) {
    try {
      const cacheKey = `${CACHE_KEY}:${exchange}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        log.debug('Контракты загружены из кеша');
        this.contracts = cached;
        return this.contracts;
      }

      const client = getExchange(exchange, apiKey, secretKey);
      if (!client) {
        log.error('Биржа не поддерживается', { exchange });
        return {};
      }

      const contracts = await client.getContracts();
      if (!contracts || !Array.isArray(contracts)) {
        log.error('Не удалось получить список контрактов', { exchange });
        return {};
      }

      // Индексируем по символу
      const indexed = {};
      for (const contract of contracts) {
        indexed[contract.symbol] = contract;
      }

      this.contracts = indexed;
      this.lastUpdate = Date.now();

      // Сохраняем в кеш
      cache.set(cacheKey, indexed, CACHE_TTL);
      log.info(`Загружено ${Object.keys(indexed).length} контрактов`);

      return this.contracts;
    } catch (error) {
      log.error('Ошибка загрузки контрактов', { error: error.message });
      return {};
    }
  }

  /**
   * Получить информацию о контракте
   */
  getContract(symbol) {
    // Нормализуем символ (убираем -USDT, пробуем разные варианты)
    const variants = [
      symbol,
      symbol.replace(/-USDT$/, ''),
      symbol.replace(/_/g, '-'),
      symbol.replace(/-/g, ''),
    ];

    for (const variant of variants) {
      if (this.contracts[variant]) {
        return this.contracts[variant];
      }
    }

    return null;
  }

  /**
   * Получить точность количества (quantityPrecision)
   */
  getQuantityPrecision(symbol) {
    const contract = this.getContract(symbol);
    if (contract && contract.quantityPrecision !== undefined) {
      return contract.quantityPrecision;
    }
    // По умолчанию — 3 знака
    return 3;
  }

  /**
   * Получить минимальное количество (tradeMinQuantity)
   */
  getMinQuantity(symbol) {
    const contract = this.getContract(symbol);
    if (contract && contract.tradeMinQuantity !== undefined) {
      return contract.tradeMinQuantity;
    }
    return 0;
  }

  /**
   * Получить точность цены (pricePrecision)
   */
  getPricePrecision(symbol) {
    const contract = this.getContract(symbol);
    if (contract && contract.pricePrecision !== undefined) {
      return contract.pricePrecision;
    }
    return 4;
  }

  /**
   * Получить статус символа (ONLINE/OFFLINE)
   */
  isSymbolOnline(symbol) {
    const contract = this.getContract(symbol);
    if (contract) {
      return contract.status === 1 && contract.apiStateOpen === 'true';
    }
    return false;
  }

  /**
   * Округлить количество с учётом точности символа
   */
  roundQuantity(symbol, quantity) {
    const precision = this.getQuantityPrecision(symbol);
    const factor = Math.pow(10, precision);
    let rounded = Math.round(quantity * factor) / factor;

    // Проверяем минимальный лот
    const minQty = this.getMinQuantity(symbol);
    if (minQty > 0 && rounded < minQty) {
      log.warn(`⚠️ Количество ${rounded} меньше минимального ${minQty} для ${symbol}, устанавливаем минимум`);
      rounded = minQty;
    }

    return rounded;
  }

  /**
   * Проверить, подходит ли количество для торговли
   */
  isValidQuantity(symbol, quantity) {
    const rounded = this.roundQuantity(symbol, quantity);
    const minQty = this.getMinQuantity(symbol);
    return rounded > 0 && (minQty === 0 || rounded >= minQty);
  }

  /**
   * Получить все активные символы
   */
  getActiveSymbols() {
    const result = [];
    for (const [symbol, contract] of Object.entries(this.contracts)) {
      if (contract.status === 1 && contract.apiStateOpen === 'true') {
        result.push(symbol);
      }
    }
    return result;
  }

  /**
   * Получить полную информацию о символе
   */
  getSymbolInfo(symbol) {
    const contract = this.getContract(symbol);
    if (!contract) {
      return {
        symbol,
        exists: false,
        precision: 3,
        minQuantity: 0,
        online: false,
      };
    }

    return {
      symbol: contract.symbol,
      exists: true,
      precision: contract.quantityPrecision || 3,
      minQuantity: contract.tradeMinQuantity || 0,
      pricePrecision: contract.pricePrecision || 4,
      online: contract.status === 1 && contract.apiStateOpen === 'true',
      size: contract.size || 1,
      leverage: contract.leverage || 10,
    };
  }
}

// Экспортируем синглтон
const symbolManager = new SymbolManager();

module.exports = {
  SymbolManager,
  symbolManager,
};