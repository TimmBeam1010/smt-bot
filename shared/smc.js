// ============================================
//  SMC (Smart Money Concepts) - Модуль
// ============================================

/**
 * Обнаружение Break of Structure (BOS)
 */
function detectBOS(candles, lookback = 20) {
    if (!candles || candles.length < lookback + 2) {
        return { type: 'NONE', lastHigh: null, lastLow: null };
    }

    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    
    // Последние две свечи
    const lastHigh = highs[highs.length - 1];
    const prevHigh = highs[highs.length - 2];
    const lastLow = lows[lows.length - 1];
    const prevLow = lows[lows.length - 2];

    // Поиск структуры
    let type = 'NONE';
    if (lastHigh > prevHigh && lastLow > prevLow) {
        type = 'BULLISH';
    } else if (lastHigh < prevHigh && lastLow < prevLow) {
        type = 'BEARISH';
    }

    return { type, lastHigh, lastLow };
}

/**
 * Обнаружение Change of Character (CHoCH)
 */
function detectCHoCH(candles, lookback = 20) {
    if (!candles || candles.length < lookback + 3) {
        return { type: 'NONE' };
    }

    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    
    // Проверяем смену структуры
    const recentHighs = highs.slice(-5);
    const recentLows = lows.slice(-5);
    
    const maxHigh = Math.max(...recentHighs);
    const minLow = Math.min(...recentLows);
    const lastHigh = recentHighs[recentHighs.length - 1];
    const lastLow = recentLows[recentLows.length - 1];

    let type = 'NONE';
    if (lastHigh > maxHigh && lastLow > minLow) {
        type = 'BULLISH';
    } else if (lastHigh < maxHigh && lastLow < minLow) {
        type = 'BEARISH';
    }

    return { type };
}

/**
 * Обнаружение Fair Value Gap (FVG)
 */
function detectFVG(candles) {
    if (!candles || candles.length < 3) return null;

    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    const prevPrevCandle = candles[candles.length - 3];

    // Бычий FVG: предыдущая свеча закрылась выше максимума позапрошлой
    if (prevCandle.close > prevPrevCandle.high && 
        lastCandle.high > prevPrevCandle.high) {
        return { type: 'BULLISH', level: prevPrevCandle.high };
    }

    // Медвежий FVG: предыдущая свеча закрылась ниже минимума позапрошлой
    if (prevCandle.close < prevPrevCandle.low && 
        lastCandle.low < prevPrevCandle.low) {
        return { type: 'BEARISH', level: prevPrevCandle.low };
    }

    return null;
}

/**
 * Обнаружение Liquidity Sweep
 */
function detectLiquiditySweep(candles, lookback = 20) {
    if (!candles || candles.length < lookback + 2) {
        return { direction: 'NONE' };
    }

    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    
    const recentHighs = highs.slice(-lookback);
    const recentLows = lows.slice(-lookback);
    
    const maxHigh = Math.max(...recentHighs);
    const minLow = Math.min(...recentLows);
    const lastHigh = highs[highs.length - 1];
    const lastLow = lows[lows.length - 1];

    let direction = 'NONE';
    if (lastHigh > maxHigh) {
        direction = 'BUY_SWEEP';
    } else if (lastLow < minLow) {
        direction = 'SELL_SWEEP';
    }

    return { direction };
}

/**
 * Обнаружение Order Block
 */
function detectOrderBlock(candles, lookback = 10) {
    if (!candles || candles.length < lookback + 2) return [];

    const blocks = [];
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    for (let i = candles.length - lookback; i < candles.length - 1; i++) {
        const prev = candles[i];
        const curr = candles[i + 1];
        
        // Блок покупки: свеча закрылась выше, чем открылась предыдущая
        if (curr.close > prev.high && prev.close > prev.open) {
            blocks.push({
                type: 'BUY',
                price: prev.high,
                timestamp: curr.timestamp || Date.now()
            });
        }
        
        // Блок продажи: свеча закрылась ниже, чем открылась предыдущая
        if (curr.close < prev.low && prev.close < prev.open) {
            blocks.push({
                type: 'SELL',
                price: prev.low,
                timestamp: curr.timestamp || Date.now()
            });
        }
    }

    return blocks;
}

module.exports = {
    detectBOS,
    detectCHoCH,
    detectFVG,
    detectLiquiditySweep,
    detectOrderBlock
};
