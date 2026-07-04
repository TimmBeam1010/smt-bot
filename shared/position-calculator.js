// ============================================
//  РАСЧЁТ TP/SL С УЧЕТОМ МАРКЕТ МЕЙКЕРА
// ============================================

const fibonacci = require('./fibonacci');
const marketMaker = require('./market-maker');

function calculatePositionLevels(symbol, entryPrice, candles, indicators, side = 'LONG', config = {}) {
    // Анализ маркет мейкера
    const mmAnalysis = marketMaker.analyzeMarketMaker(candles);
    
    const minPrice = 0.00001;
    
    if (!candles || candles.length === 0) {
        const stopLoss = side === 'LONG' ? entryPrice * 0.985 : entryPrice * 1.015;
        const takeProfit = side === 'LONG' ? entryPrice * 1.03 : entryPrice * 0.97;
        const risk = Math.abs(entryPrice - stopLoss);
        const reward = Math.abs(takeProfit - entryPrice);
        const ratio = risk > 0 ? reward / risk : 0;
        return {
            stopLoss: Math.max(stopLoss, minPrice),
            takeProfit: Math.max(takeProfit, minPrice),
            ratio: Math.round(ratio * 100) / 100,
            risk: Math.round(risk * 100) / 100,
            reward: Math.round(reward * 100) / 100,
            valid: ratio >= (config.minRatio || 2.0),
            mmAnalysis: mmAnalysis
        };
    }

    let stopLoss = calculateStopLoss(entryPrice, candles, indicators, side);
    let takeProfit = calculateTakeProfit(entryPrice, candles, indicators, side, stopLoss);
    
    // Корректировка на основе маркет мейкера
    if (mmAnalysis.isActive) {
        const adjustment = 1 + (mmAnalysis.score / 10);
        if (side === 'LONG') {
            stopLoss = stopLoss * (1 - mmAnalysis.strength * 0.01);
            takeProfit = takeProfit * (1 + mmAnalysis.strength * 0.02);
        } else {
            stopLoss = stopLoss * (1 + mmAnalysis.strength * 0.01);
            takeProfit = takeProfit * (1 - mmAnalysis.strength * 0.02);
        }
    }
    
    stopLoss = Math.max(stopLoss, minPrice);
    takeProfit = Math.max(takeProfit, minPrice);
    
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);
    const ratio = risk > 0 ? reward / risk : 0;
    
    return {
        stopLoss: Math.round(stopLoss * 100) / 100,
        takeProfit: Math.round(takeProfit * 100) / 100,
        ratio: Math.round(ratio * 100) / 100,
        risk: Math.round(risk * 100) / 100,
        reward: Math.round(reward * 100) / 100,
        valid: ratio >= (config.minRatio || 2.0),
        mmAnalysis: mmAnalysis
    };
}

function calculateStopLoss(entryPrice, candles, indicators, side = 'LONG') {
    if (!candles || candles.length === 0) {
        return side === 'LONG' ? entryPrice * 0.985 : entryPrice * 1.015;
    }

    // 1. SMC: BOS (от маркет мейкера)
    const bos = marketMaker.detectBOS(candles, 20);
    if (bos) {
        if (side === 'LONG' && bos.lastLow) {
            const sl = bos.lastLow * 0.999;
            console.log(`📌 SL по BOS (LONG): ${sl}`);
            return sl;
        }
        if (side === 'SHORT' && bos.lastHigh) {
            const sl = bos.lastHigh * 1.001;
            console.log(`📌 SL по BOS (SHORT): ${sl}`);
            return sl;
        }
    }
    
    // 2. SMC: Order Block
    const orderBlocks = marketMaker.detectOrderBlock(candles);
    if (orderBlocks && orderBlocks.length > 0) {
        const lastBlock = orderBlocks[orderBlocks.length - 1];
        if (side === 'LONG') {
            const sl = lastBlock.price * 0.995;
            console.log(`📌 SL по Order Block (LONG): ${sl}`);
            return sl;
        } else {
            const sl = lastBlock.price * 1.005;
            console.log(`📌 SL по Order Block (SHORT): ${sl}`);
            return sl;
        }
    }
    
    // 3. ATR
    const atr = indicators?.atr || 0;
    if (atr > 0) {
        const multiplier = 1.5;
        if (side === 'LONG') {
            const sl = entryPrice - atr * multiplier;
            console.log(`📌 SL по ATR (LONG): ${sl}`);
            return sl;
        } else {
            const sl = entryPrice + atr * multiplier;
            console.log(`📌 SL по ATR (SHORT): ${sl}`);
            return sl;
        }
    }
    
    // 4. Fibonacci
    try {
        const high = Math.max(...candles.map(c => c.high));
        const low = Math.min(...candles.map(c => c.low));
        const fibLevels = fibonacci.getFibonacciLevels(high, low);
        if (side === 'LONG') {
            const sl = fibLevels.level786;
            console.log(`📌 SL по Fibonacci (LONG): ${sl}`);
            return sl;
        } else {
            const sl = fibLevels.level236;
            console.log(`📌 SL по Fibonacci (SHORT): ${sl}`);
            return sl;
        }
    } catch (e) {}
    
    const sl = side === 'LONG' ? entryPrice * 0.985 : entryPrice * 1.015;
    console.log(`📌 Дефолтный SL: ${sl}`);
    return sl;
}

function calculateTakeProfit(entryPrice, candles, indicators, side = 'LONG', stopLoss) {
    const minPrice = 0.00001;
    
    // Базовый Risk/Reward
    const risk = Math.abs(entryPrice - stopLoss);
    const minReward = risk * 2;
    let tp = side === 'LONG' ? entryPrice + minReward : entryPrice - minReward;
    console.log(`📌 Базовый TP: ${tp}`);
    
    // Fibonacci
    if (candles && candles.length > 0) {
        try {
            const high = Math.max(...candles.map(c => c.high));
            const low = Math.min(...candles.map(c => c.low));
            const fibLevels = fibonacci.getFibonacciLevels(high, low);
            if (side === 'LONG') {
                const fibTp = high + (high - low) * 0.272;
                if (fibTp > tp && isFinite(fibTp)) {
                    tp = fibTp;
                    console.log(`📌 Улучшенный TP по Fibonacci: ${tp}`);
                }
            } else {
                const fibTp = low - (high - low) * 0.272;
                if (fibTp < tp && isFinite(fibTp)) {
                    tp = fibTp;
                    console.log(`📌 Улучшенный TP по Fibonacci: ${tp}`);
                }
            }
        } catch (e) {}
    }
    
    // Коррекция
    if (side === 'LONG') {
        if (tp <= entryPrice) tp = entryPrice * 1.03;
    } else {
        if (tp >= entryPrice) tp = entryPrice * 0.97;
    }
    
    if (!tp || !isFinite(tp) || tp <= 0 || isNaN(tp)) {
        tp = side === 'LONG' ? entryPrice * 1.03 : entryPrice * 0.97;
    }
    
    return Math.max(tp, minPrice);
}

function calculatePositionSize({ balance, riskPercent, entryPrice, stopLoss, leverage }) {
    if (!balance || !entryPrice || !stopLoss) return 0;
    
    const riskAmount = balance * (riskPercent / 100);
    const priceDiff = Math.abs(entryPrice - stopLoss);
    
    if (priceDiff === 0 || priceDiff < 0.0001) return 0;
    
    let size = (riskAmount / priceDiff) * leverage;
    
    if (size < 0.001) size = 0.001;
    
    const maxSize = (balance * 0.1) / entryPrice;
    if (size > maxSize) size = maxSize;
    
    return Math.round(size * 10000) / 10000;
}

module.exports = { calculatePositionSize, calculatePositionLevels };
