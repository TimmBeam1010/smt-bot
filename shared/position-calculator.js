// ============================================
//  РАСЧЁТ TP/SL НА ОСНОВЕ АНАЛИЗА
// ============================================

const fibonacci = require('./fibonacci');
const marketMaker = require('./market-maker');

/**
 * Рассчитать уровни стоп-лосс и тейк-профит
 */
function calculatePositionLevels(symbol, entryPrice, candles, indicators, side = 'LONG', config = {}) {
    const stopLoss = calculateStopLoss(entryPrice, candles, indicators, side);
    const takeProfit = calculateTakeProfit(entryPrice, candles, indicators, side, stopLoss);
    
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);
    const ratio = risk > 0 ? reward / risk : 0;
    
    return {
        stopLoss: Math.round(stopLoss * 100) / 100,
        takeProfit: Math.round(takeProfit * 100) / 100,
        ratio: Math.round(ratio * 100) / 100,
        risk: Math.round(risk * 100) / 100,
        reward: Math.round(reward * 100) / 100,
        valid: ratio >= (config.minRatio || 2.0)
    };
}

/**
 * Рассчитать стоп-лосс
 */
function calculateStopLoss(entryPrice, candles, indicators, side = 'LONG') {
    // 1. SMC: BOS
    const bos = marketMaker.detectBOS(candles, 20);
    if (bos) {
        if (side === 'LONG' && bos.lastLow) {
            return bos.lastLow * 0.999;
        }
        if (side === 'SHORT' && bos.lastHigh) {
            return bos.lastHigh * 1.001;
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
    
    // 3. ATR
    const atr = indicators?.atr || 0;
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
 * Рассчитать тейк-профит
 */
function calculateTakeProfit(entryPrice, candles, indicators, side = 'LONG', stopLoss) {
    // 1. Уровни Фибоначчи (расширение)
    const high = Math.max(...candles.map(c => c.high));
    const low = Math.min(...candles.map(c => c.low));
    const fibLevels = fibonacci.getFibonacciLevels(high, low);
    
    if (side === 'LONG') {
        return high + (high - low) * 0.272;
    } else {
        return low - (high - low) * 0.272;
    }
    
    // 2. Соотношение риск/прибыль (минимум 1:2)
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