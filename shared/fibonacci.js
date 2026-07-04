// ============================================
//  МОДУЛЬ ФИБОНАЧЧИ
// ============================================

/**
 * Рассчитать уровни Фибоначчи
 * @param {number} high - Максимум движения
 * @param {number} low - Минимум движения
 * @returns {Object} Уровни Фибоначчи
 */
function getFibonacciLevels(high, low) {
    const diff = high - low;
    return {
        level0: low,
        level236: low + diff * 0.236,
        level382: low + diff * 0.382,
        level5: low + diff * 0.5,
        level618: low + diff * 0.618,
        level786: low + diff * 0.786,
        level1: high,
        extensions: {
            level1272: high + diff * 0.272,
            level1618: high + diff * 0.618,
            level2618: high + diff * 1.618,
        }
    };
}

/**
 * Найти ближайший уровень Фибоначчи
 */
function findNearestFibonacciLevel(price, fibLevels) {
    let nearest = null;
    let minDiff = Infinity;
    const allLevels = { ...fibLevels, ...fibLevels.extensions };
    for (const [name, level] of Object.entries(allLevels)) {
        const diff = Math.abs(price - level);
        if (diff < minDiff) {
            minDiff = diff;
            nearest = { name, level, diff };
        }
    }
    return nearest;
}

/**
 * Проверить, находится ли цена на уровне Фибоначчи
 */
function isPriceAtFibonacci(price, fibLevels, tolerance = 0.001) {
    const allLevels = { ...fibLevels, ...fibLevels.extensions };
    for (const [name, level] of Object.entries(allLevels)) {
        if (Math.abs(price - level) / level < tolerance) {
            return name;
        }
    }
    return null;
}

module.exports = {
    getFibonacciLevels,
    findNearestFibonacciLevel,
    isPriceAtFibonacci
};