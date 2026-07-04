// ============================================
//  МОДУЛЬ МАРКЕТ МЕЙКЕРА
// ============================================

function detectLiquiditySweep(candles, lookback = 20) {
    if (candles.length < lookback) return null;
    const recent = candles.slice(-lookback);
    const lastCandle = recent[recent.length - 1];
    const previousCandles = recent.slice(0, -1);
    const highs = previousCandles.map(c => c.high);
    const lows = previousCandles.map(c => c.low);
    const localHigh = Math.max(...highs);
    const localLow = Math.min(...lows);
    return {
        sweepHigh: lastCandle.high > localHigh && (lastCandle.high - localHigh) / localHigh < 0.02,
        sweepLow: lastCandle.low < localLow && (localLow - lastCandle.low) / localLow < 0.02,
        localHigh,
        localLow,
        direction: lastCandle.high > localHigh ? 'HIGH_SWEEP' : lastCandle.low < localLow ? 'LOW_SWEEP' : 'NONE'
    };
}

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
        type: lastCandle.close > lastHigh ? 'BULLISH_BOS' : lastCandle.close < lastLow ? 'BEARISH_BOS' : 'NONE'
    };
}

function detectOrderBlock(candles, volumeMultiplier = 2) {
    if (candles.length < 5) return [];
    const avgVolume = candles.reduce((sum, c) => sum + c.volume, 0) / candles.length;
    const orderBlocks = [];
    for (let i = 2; i < candles.length - 1; i++) {
        const candle = candles[i];
        if (candle.volume > avgVolume * volumeMultiplier) {
            orderBlocks.push({
                price: candle.close > candle.open ? candle.high : candle.low,
                volume: candle.volume,
                type: candle.close > candle.open ? 'BUY' : 'SELL',
                index: i
            });
        }
    }
    return orderBlocks;
}

function detectCHoCH(candles, lookback = 20) {
    if (candles.length < lookback) return null;
    const recent = candles.slice(-lookback);
    const firstHalf = recent.slice(0, Math.floor(lookback / 2));
    const secondHalf = recent.slice(Math.floor(lookback / 2));
    const firstAvg = firstHalf.reduce((sum, c) => sum + c.close, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, c) => sum + c.close, 0) / secondHalf.length;
    const firstVolatility = firstHalf.reduce((sum, c) => sum + (c.high - c.low), 0) / firstHalf.length;
    const secondVolatility = secondHalf.reduce((sum, c) => sum + (c.high - c.low), 0) / secondHalf.length;
    const priceChange = (secondAvg - firstAvg) / firstAvg;
    const volatilityChange = (secondVolatility - firstVolatility) / firstVolatility;
    return {
        priceChange,
        volatilityChange,
        type: Math.abs(priceChange) > 0.01 && Math.abs(volatilityChange) > 0.2 ? 'CHoCH_DETECTED' : 'NONE',
        firstAvg,
        secondAvg
    };
}

module.exports = {
    detectLiquiditySweep,
    detectBOS,
    detectOrderBlock,
    detectCHoCH
};