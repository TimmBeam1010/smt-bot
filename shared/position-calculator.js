// ============================================
//  РАСЧЁТ TP/SL НА ОСНОВЕ АНАЛИЗА
// ============================================

const fibonacci = require('./fibonacci');
const marketMaker = require('./market-maker');

function calculatePositionLevels(symbol, entryPrice, candles, indicators, side = 'LONG', config = {}) {
    // Если свечей нет, используем дефолтные значения
    if (!candles || candles.length === 0) {
        const stopLoss = side === 'LONG' ? entryPrice * 0.985 : entryPrice * 1.015;
        const takeProfit = side === 'LONG' ? entryPrice * 1.03 : entryPrice * 0.97;
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

function calculateStopLoss(entryPrice, candles, indicators, side = 'LONG') {
    if (!candles || candles.length === 0) {
        return side === 'LONG' ? entryPrice * 0.985 : entryPrice * 1.015;
    }

    const bos = marketMaker.detectBOS(candles, 20);
    if (bos) {
        if (side === 'LONG' && bos.lastLow) return bos.lastLow * 0.999;
        if (side === 'SHORT' && bos.lastHigh) return bos.lastHigh * 1.001;
    }
    
    const orderBlocks = marketMaker.detectOrderBlock(candles);
    if (orderBlocks && orderBlocks.length > 0) {
        const lastBlock = orderBlocks[orderBlocks.length - 1];
        if (side === 'LONG') return lastBlock.price * 0.995;
        else return lastBlock.price * 1.005;
    }
    
    const atr = indicators?.atr || 0;
    if (atr > 0) {
        const multiplier = 1.5;
        if (side === 'LONG') return entryPrice - atr * multiplier;
        else return entryPrice + atr * multiplier;
    }
    
    try {
        const high = Math.max(...candles.map(c => c.high));
        const low = Math.min(...candles.map(c => c.low));
        const fibLevels = fibonacci.getFibonacciLevels(high, low);
        if (side === 'LONG') return fibLevels.level786;
        else return fibLevels.level236;
    } catch (e) {}
    
    return side === 'LONG' ? entryPrice * 0.985 : entryPrice * 1.015;
}

function calculateTakeProfit(entryPrice, candles, indicators, side = 'LONG', stopLoss) {
    if (!candles || candles.length === 0) {
        const risk = Math.abs(entryPrice - stopLoss);
        const minReward = risk * 2;
        return side === 'LONG' ? entryPrice + minReward : entryPrice - minReward;
    }

    try {
        const high = Math.max(...candles.map(c => c.high));
        const low = Math.min(...candles.map(c => c.low));
        const fibLevels = fibonacci.getFibonacciLevels(high, low);
        if (side === 'LONG') return high + (high - low) * 0.272;
        else return low - (high - low) * 0.272;
    } catch (e) {}
    
    const risk = Math.abs(entryPrice - stopLoss);
    const minReward = risk * 2;
    if (side === 'LONG') return entryPrice + minReward;
    else return entryPrice - minReward;
}

function calculatePositionSize({ balance, riskPercent, entryPrice, stopLoss, leverage }) {
    if (!balance || !entryPrice || !stopLoss) return 0.001;
    const riskAmount = balance * (riskPercent / 100);
    const priceDiff = Math.abs(entryPrice - stopLoss);
    if (priceDiff === 0) return 0.001;
    let size = (riskAmount / priceDiff) * leverage;
    if (size < 0.001) size = 0.001;
    return Math.round(size * 10000) / 10000;
}

module.exports = { calculatePositionSize, calculatePositionLevels };
