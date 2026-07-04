// ============================================
//  РАСЧЁТ TP/SL НА ОСНОВЕ АНАЛИЗА
// ============================================

const fibonacci = require('./fibonacci');
const marketMaker = require('./market-maker');
const dominance = require('./dominance');

/**
 * Рассчитать уровни стоп-лосс и тейк-профит на основе рыночной структуры
 * @param {string} symbol - Торговая пара
 * @param {number} entryPrice - Цена входа
 * @param {Array} candles - Свечи (OHLCV)
 * @param {Object} indicators - Индикаторы (RSI, MACD, ATR)
 * @param {string} side - Направление (LONG / SHORT)
 * @param {Object} config - Настройки
 * @returns {Object} { stopLoss, takeProfit, ratio, valid }
 */
function calculatePositionLevels(symbol, entryPrice, candles, indicators, side = 'LONG', config = {}) {
    // 1. Стоп-лосс (на основе структуры)
    const stopLoss = calculateStopLoss(entryPrice, candles, indicators, side);
    
    // 2. Тейк-профит (на основе целей)
    const takeProfit = calculateTakeProfit(entryPrice, candles, indicators, side, stopLoss);
    
    // 3. Проверка соотношения риск/прибыль
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);
    const ratio = reward / risk;
    
    return {
        stopLoss,
        takeProfit,
        ratio,
        risk,
        reward,
        valid: ratio >= config.minRatio || 2.0
    };
}

/**
 * Рассчитать стоп-лосс на основе рыночной структуры
 */
function calculateStopLoss(entryPrice, candles, indicators, side = 'LONG') {
    // 1. SMC: Break of Structure (BOS)
    const bos = marketMaker.detectBOS(candles, 20);
    if (bos) {
        if (side === 'LONG' && bos.lastLow) {
            return bos.lastLow * 0.999; // Чуть ниже минимума
        }
        if (side === 'SHORT' && bos.lastHigh) {
            return bos.lastHigh * 1.001; // Чуть выше максимума
        }
    }
    
    // 2. SMC: Order Block
    const orderBlocks = marketMaker.detectOrderBlock(candles);
    if (orderBlocks.length > 0) {
        const lastBlock = orderBlocks[orderBlocks.length - 1];
        if (side === 'LONG') {
            return lastBlock.price * 0.995;
        } else {
            return lastBlock.price * 1.005;
        }
    }
    
    // 3. ATR (Average True Range)
    const atr = indicators.atr || 0;
    if (atr > 0) {
        const multiplier = 1.5;
        if (side === 'LONG') {
            return entryPrice - atr * multiplier;
        } else {
            return entryPrice + atr * multiplier;
        }
    }
    
    // 4. Фибоначчи 0.786
    const high = Math.max(...candles.map(c => c.high));
    const low = Math.min(...candles.map(c => c.low));
    const fibLevels = fibonacci.getFibonacciLevels(high, low);
    if (side === 'LONG') {
        return fibLevels.level786;
    } else {
        return fibLevels.level236;
    }
    
    // 5. По умолчанию (1.5%)
    return side === 'LONG' 
        ? entryPrice * 0.985 
        : entryPrice * 1.015;
}

/**
 * Рассчитать тейк-профит на основе целей
 */
function calculateTakeProfit(entryPrice, candles, indicators, side = 'LONG', stopLoss) {
    // 1. SMC: Fair Value Gap (FVG)
    // можно добавить позже
    
    // 2. Уровни Фибоначчи (расширение)
    const high = Math.max(...candles.map(c => c.high));
    const low = Math.min(...candles.map(c => c.low));
    const fibLevels = fibonacci.getFibonacciLevels(high, low);
    
    if (side === 'LONG') {
        // Цель: 1.272 от движения
        const target = high + (high - low) * 0.272;
        return target;
    } else {
        const target = low - (high - low) * 0.272;
        return target;
    }
    
    // 3. Соотношение риск/прибыль (минимум 1:2)
    const risk = Math.abs(entryPrice - stopLoss);
    const minReward = risk * 2;
    if (side === 'LONG') {
        return entryPrice + minReward;
    } else {
        return entryPrice - minReward;
    }
}

module.exports = {
    calculatePositionLevels
};