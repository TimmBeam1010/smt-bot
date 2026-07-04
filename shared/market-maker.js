// ============================================
//  МОДУЛЬ МАРКЕТ МЕЙКЕРА (РАСШИРЕННАЯ ВЕРСИЯ)
// ============================================

/**
 * Обнаружить сбор ликвидности (Liquidity Sweep)
 */
function detectLiquiditySweep(candles, lookback = 20) {
    if (candles.length < lookback) return null;
    const recent = candles.slice(-lookback);
    const lastCandle = recent[recent.length - 1];
    const previousCandles = recent.slice(0, -1);
    const highs = previousCandles.map(c => c.high);
    const lows = previousCandles.map(c => c.low);
    const localHigh = Math.max(...highs);
    const localLow = Math.min(...lows);
    
    const sweepHigh = lastCandle.high > localHigh && (lastCandle.high - localHigh) / localHigh < 0.02;
    const sweepLow = lastCandle.low < localLow && (localLow - lastCandle.low) / localLow < 0.02;
    
    return {
        sweepHigh,
        sweepLow,
        localHigh,
        localLow,
        direction: sweepHigh ? 'HIGH_SWEEP' : sweepLow ? 'LOW_SWEEP' : 'NONE',
        strength: sweepHigh ? (lastCandle.high - localHigh) / localHigh : 
                  sweepLow ? (localLow - lastCandle.low) / localLow : 0
    };
}

/**
 * Обнаружить Break of Structure (BOS)
 */
function detectBOS(candles, lookback = 20) {
    if (candles.length < lookback) return null;
    const recent = candles.slice(-lookback);
    const lastCandle = recent[recent.length - 1];
    const highs = recent.map(c => c.high);
    const lows = recent.map(c => c.low);
    const lastHigh = Math.max(...highs.slice(0, -1));
    const lastLow = Math.min(...lows.slice(0, -1));
    
    return {
        bullish: lastCandle.close > lastHigh,
        bearish: lastCandle.close < lastLow,
        lastHigh,
        lastLow,
        type: lastCandle.close > lastHigh ? 'BULLISH_BOS' : lastCandle.close < lastLow ? 'BEARISH_BOS' : 'NONE',
        strength: lastCandle.close > lastHigh ? (lastCandle.close - lastHigh) / lastHigh :
                  lastCandle.close < lastLow ? (lastLow - lastCandle.close) / lastLow : 0
    };
}

/**
 * Обнаружить Change of Character (CHoCH)
 */
function detectCHoCH(candles, lookback = 20) {
    if (candles.length < lookback + 3) return null;
    const recent = candles.slice(-lookback);
    const lastCandle = recent[recent.length - 1];
    const prevCandle = recent[recent.length - 2];
    const highs = recent.map(c => c.high);
    const lows = recent.map(c => c.low);
    
    const lastHigh = highs[highs.length - 1];
    const prevHigh = highs[highs.length - 2];
    const lastLow = lows[lows.length - 1];
    const prevLow = lows[lows.length - 2];
    
    return {
        bullish: lastLow > prevLow && lastCandle.close > prevCandle.close,
        bearish: lastHigh < prevHigh && lastCandle.close < prevCandle.close,
        type: (lastLow > prevLow && lastCandle.close > prevCandle.close) ? 'BULLISH_CHOCH' :
              (lastHigh < prevHigh && lastCandle.close < prevCandle.close) ? 'BEARISH_CHOCH' : 'NONE'
    };
}

/**
 * Обнаружить Order Block
 */
function detectOrderBlock(candles, lookback = 10) {
    if (candles.length < lookback + 2) return [];
    const blocks = [];
    const recent = candles.slice(-lookback);
    
    for (let i = 0; i < recent.length - 1; i++) {
        const prev = recent[i];
        const curr = recent[i + 1];
        const body = Math.abs(curr.close - curr.open);
        const prevBody = Math.abs(prev.close - prev.open);
        
        // Бычий Order Block
        if (curr.close > prev.high && body > prevBody * 1.5) {
            blocks.push({
                type: 'BUY',
                price: prev.high,
                strength: body / prevBody,
                timestamp: curr.timestamp || Date.now()
            });
        }
        // Медвежий Order Block
        if (curr.close < prev.low && body > prevBody * 1.5) {
            blocks.push({
                type: 'SELL',
                price: prev.low,
                strength: body / prevBody,
                timestamp: curr.timestamp || Date.now()
            });
        }
    }
    
    return blocks;
}

/**
 * Обнаружить манипуляцию (Wyckoff)
 */
function detectWyckoff(candles, lookback = 30) {
    if (candles.length < lookback) return null;
    const recent = candles.slice(-lookback);
    const volumes = recent.map(c => c.volume);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const lastVolumes = volumes.slice(-5);
    const avgLastVolume = lastVolumes.reduce((a, b) => a + b, 0) / lastVolumes.length;
    
    // Рост объема + узкий диапазон = манипуляция
    const volumeSpike = avgLastVolume > avgVolume * 2;
    const priceRange = (Math.max(...recent.map(c => c.high)) - Math.min(...recent.map(c => c.low))) / 
                       Math.min(...recent.map(c => c.low));
    const narrowRange = priceRange < 0.02;
    
    return {
        isManipulation: volumeSpike && narrowRange,
        volumeSpike,
        narrowRange,
        type: volumeSpike && narrowRange ? 'MANIPULATION' : 'NONE'
    };
}

/**
 * Обнаружить алгоритмическую торговлю (Spoofing)
 */
function detectSpoofing(candles) {
    if (candles.length < 10) return null;
    const recent = candles.slice(-10);
    let wicksCount = 0;
    let avgWickSize = 0;
    
    for (const candle of recent) {
        const body = Math.abs(candle.close - candle.open);
        const range = candle.high - candle.low;
        const wickSize = range - body;
        avgWickSize += wickSize / range;
        if (wickSize > range * 0.7) wicksCount++;
    }
    avgWickSize /= recent.length;
    
    // Много длинных теней = спуфинг
    const isSpoofing = wicksCount > 5 && avgWickSize > 0.4;
    
    return {
        isSpoofing: isSpoofing,
        wicksCount: wicksCount,
        avgWickSize: avgWickSize,
        direction: wicksCount > 5 && avgWickSize > 0.4 ? 'SPOOFING' : 'NONE'
    };
}

/**
 * Получить полный анализ маркет мейкера
 */
function analyzeMarketMaker(candles) {
    const liquiditySweep = detectLiquiditySweep(candles);
    const bos = detectBOS(candles);
    const choch = detectCHoCH(candles);
    const orderBlocks = detectOrderBlock(candles);
    const wyckoff = detectWyckoff(candles);
    const spoofing = detectSpoofing(candles);
    
    const signals = [];
    if (liquiditySweep?.direction !== 'NONE') signals.push('LIQUIDITY_SWEEP');
    if (bos?.type !== 'NONE') signals.push('BOS');
    if (choch?.type !== 'NONE') signals.push('CHOCH');
    if (orderBlocks.length > 0) signals.push('ORDER_BLOCK');
    if (wyckoff?.isManipulation) signals.push('WYCKOFF_MANIPULATION');
    if (spoofing?.isSpoofing) signals.push('SPOOFING');
    
    const score = signals.length;
    const isActive = score >= 2;
    
    return {
        isActive,
        score,
        signals,
        liquiditySweep,
        bos,
        choch,
        orderBlocks,
        wyckoff,
        spoofing,
        recommendation: isActive ? 'ACTIVE' : 'HOLD',
        strength: isActive ? (score / 6) : 0
    };
}

module.exports = {
    detectLiquiditySweep,
    detectBOS,
    detectCHoCH,
    detectOrderBlock,
    detectWyckoff,
    detectSpoofing,
    analyzeMarketMaker
};
