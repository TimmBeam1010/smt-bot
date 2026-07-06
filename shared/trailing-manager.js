// ============================================
//  МОДУЛЬ УПРАВЛЕНИЯ ТРЕЙЛИНГ-СТОПАМИ
// ============================================

class TrailingStopManager {
  constructor() {
    // Хранилище трейлинг-стопов по ключу symbol-side
    this.trailingStops = new Map();
  }

  /**
   * Обновление трейлинг-стопа
   * @param {string} symbol - Символ (например, BTC-USDT)
   * @param {number} currentPrice - Текущая цена
   * @param {string} side - Направление: 'LONG' или 'SHORT'
   * @param {number} entryPrice - Цена входа
   * @param {number} trailingPercent - Процент трейлинга (по умолчанию 0.02 = 2%)
   * @returns {number|null} - Новая цена стопа или null
   */
  update(symbol, currentPrice, side, entryPrice, trailingPercent = 0.02) {
    const key = `${symbol}-${side}`;
    let stop = this.trailingStops.get(key);

    if (!stop) {
      // Инициализация нового стопа
      stop = {
        highest: entryPrice,
        lowest: entryPrice,
        stopPrice: null,
        activated: false,
      };
      this.trailingStops.set(key, stop);
    }

    // Для LONG: стоп двигается вверх
    if (side === 'LONG') {
      if (currentPrice > stop.highest) {
        stop.highest = currentPrice;
        const newStop = currentPrice * (1 - trailingPercent);
        if (!stop.stopPrice || newStop > stop.stopPrice) {
          stop.stopPrice = newStop;
          stop.activated = true;
        }
      }
    }
    // Для SHORT: стоп двигается вниз
    else if (side === 'SHORT') {
      if (currentPrice < stop.lowest) {
        stop.lowest = currentPrice;
        const newStop = currentPrice * (1 + trailingPercent);
        if (!stop.stopPrice || newStop < stop.stopPrice) {
          stop.stopPrice = newStop;
          stop.activated = true;
        }
      }
    }

    this.trailingStops.set(key, stop);
    return stop.stopPrice;
  }

  /**
   * Получение текущего стопа
   * @param {string} symbol
   * @param {string} side
   * @returns {number|null}
   */
  getStopPrice(symbol, side) {
    const key = `${symbol}-${side}`;
    const stop = this.trailingStops.get(key);
    return stop?.stopPrice || null;
  }

  /**
   * Получение всей информации о стопе
   * @param {string} symbol
   * @param {string} side
   * @returns {object|null}
   */
  getStopInfo(symbol, side) {
    const key = `${symbol}-${side}`;
    return this.trailingStops.get(key) || null;
  }

  /**
   * Удаление стопа (при закрытии позиции)
   * @param {string} symbol
   * @param {string} side
   */
  clear(symbol, side) {
    const key = `${symbol}-${side}`;
    this.trailingStops.delete(key);
  }

  /**
   * Проверка, сработал ли стоп
   * @param {string} symbol
   * @param {string} side
   * @param {number} currentPrice
   * @returns {boolean}
   */
  shouldStop(symbol, side, currentPrice) {
    const stopPrice = this.getStopPrice(symbol, side);
    if (!stopPrice) return false;

    if (side === 'LONG') {
      return currentPrice <= stopPrice;
    } else {
      return currentPrice >= stopPrice;
    }
  }

  /**
   * Очистка всех стопов
   */
  clearAll() {
    this.trailingStops.clear();
  }
}

module.exports = { TrailingStopManager };