// ============================================
//  ТОРГОВАЯ ЛОГИКА (ПОЛНОСТЬЮ БЕЗ LOW)
// ============================================

const axios = require('axios');

// ============================================
//  КЕШИРОВАНИЕ ЦЕН
// ============================================
const priceCache = new Map();
const CACHE_TTL = 10000;

function getCachedPrice(symbol, exchange) {
    const key = `${exchange}:${symbol}`;
    const cached = priceCache.get(key);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        return cached.price;
    }
    return null;
}

function setCachedPrice(symbol, exchange, price) {
    const key = `${exchange}:${symbol}`;
    priceCache.set(key, { price, timestamp: Date.now() });
}

// ============================================
//  СПИСОК АКТИВОВ
// ============================================
const SYMBOLS_HOT = [
    'BTC-USDT', 'ETH-USDT', 'BNB-USDT', 'SOL-USDT', 'XRP-USDT',
    'ADA-USDT', 'DOGE-USDT', 'TRX-USDT', 'DOT-USDT', 'MATIC-USDT',
];

const SYMBOLS_COLD = [
    'VET-USDT', 'ICP-USDT', 'FIL-USDT', 'EGLD-USDT', 'THETA-USDT',
    'HNT-USDT', 'XMR-USDT', 'ARB-USDT', 'MKR-USDT', 'AAVE-USDT',
];

const SYMBOLS = [...SYMBOLS_HOT, ...SYMBOLS_COLD];

// ============================================
//  КОНФИГУРАЦИЯ БИРЖ
// ============================================
const EXCHANGES = {
    binance: {
        name: 'Binance',
        url: (symbol) => `https://api.binance.com/api/v3/ticker/price?symbol=${symbol.replace('-', '')}`,
        parse: (data) => data?.price ? parseFloat(data.price) : null
    },
    bybit: {
        name: 'Bybit',
        url: (symbol) => `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol.replace('-', '')}`,
        parse: (data) => {
            try {
                if (data?.result?.list?.length > 0) {
                    const ticker = data.result.list[0];
                    if (ticker?.lastPrice) return parseFloat(ticker.lastPrice);
                }
                return null;
            } catch (e) { return null; }
        }
    },
    bingx: {
        name: 'BingX',
        url: (symbol) => `https://open-api.bingx.com/openApi/spot/v1/ticker/price?symbol=${symbol.replace('-', '_')}`,
        parse: (data) => {
            try {
                if (data?.data?.length > 0 && data.data[0]?.trades?.length > 0) {
                    return parseFloat(data.data[0].trades[0].price);
                }
                return data?.price ? parseFloat(data.price) : null;
            } catch (e) { return null; }
        }
    }
};

// ============================================
//  ВСЕ ИНДИКАТОРЫ
// ============================================
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;
    const deltas = prices.slice(1).map((p, i) => p - prices[i]);
    const gains = deltas.map(d => d > 0 ? d : 0);
    const losses = deltas.map(d => d < 0 ? -d : 0);
    const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
}

function calculateMACD(prices, fast = 12, slow = 26, signal = 9) {
    if (prices.length < slow + signal) return null;
    const emaFast = calculateEMA(prices, fast);
    const emaSlow = calculateEMA(prices, slow);
    const macdLine = emaFast - emaSlow;
    const macdValues = [];
    for (let i = slow; i < prices.length; i++) {
        const emaF = calculateEMA(prices.slice(0, i + 1), fast);
        const emaS = calculateEMA(prices.slice(0, i + 1), slow);
        macdValues.push(emaF - emaS);
    }
    const signalLine = calculateEMA(macdValues, signal);
    return { macd: macdLine, signal: signalLine, histogram: macdLine - signalLine };
}

function calculateEMA(data, period) {
    if (data.length < period) return data.reduce((a, b) => a + b, 0) / data.length;
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
        ema = data[i] * k + ema * (1 - k);
    }
    return ema;
}

function calculateSMA(data, period) {
    if (data.length < period) return null;
    return data.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateBollingerBands(prices, period = 20, stdDev = 2) {
    if (prices.length < period) return null;
    const slice = prices.slice(-period);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, p) => a + Math.pow(p - sma, 2), 0) / period;
    const std = Math.sqrt(variance);
    return { upper: sma + stdDev * std, middle: sma, lower: sma - stdDev * std };
}

function calculateStochastic(highs, lows, closes, period = 14, kPeriod = 3, dPeriod = 3) {
    if (closes.length < period) return null;
    const kValues = [];
    for (let i = period - 1; i < closes.length; i++) {
        const highSlice = highs.slice(i - period + 1, i + 1);
        const lowSlice = lows.slice(i - period + 1, i + 1);
        const high = Math.max(...highSlice);
        const low = Math.min(...lowSlice);
        const close = closes[i];
        kValues.push(high - low === 0 ? 50 : (close - low) / (high - low) * 100);
    }
    if (kValues.length < kPeriod) return null;
    const k = kValues[kValues.length - 1];
    const d = kValues.slice(-dPeriod).reduce((a, b) => a + b, 0) / dPeriod;
    return { k, d };
}

function calculateIchimoku(highs, lows, conversionPeriod = 9, basePeriod = 26, spanPeriod = 52) {
    if (highs.length < spanPeriod || lows.length < spanPeriod) return null;
    const conversionHigh = Math.max(...highs.slice(-conversionPeriod));
    const conversionLow = Math.min(...lows.slice(-conversionPeriod));
    const conversion = (conversionHigh + conversionLow) / 2;
    const baseHigh = Math.max(...highs.slice(-basePeriod));
    const baseLow = Math.min(...lows.slice(-basePeriod));
    const base = (baseHigh + baseLow) / 2;
    const spanA = (conversion + base) / 2;
    const spanBHigh = Math.max(...highs.slice(-spanPeriod));
    const spanBLow = Math.min(...lows.slice(-spanPeriod));
    const spanB = (spanBHigh + spanBLow) / 2;
    return { conversion, base, spanA, spanB };
}

function calculateADX(highs, lows, closes, period = 14) {
    if (highs.length < period + 1 || lows.length < period + 1) return null;
    const tr = [];
    const plusDM = [];
    const minusDM = [];
    for (let i = 1; i < closes.length; i++) {
        const high = highs[i], low = lows[i];
        const prevHigh = highs[i - 1], prevLow = lows[i - 1], prevClose = closes[i - 1];
        tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
        const upMove = high - prevHigh;
        const downMove = prevLow - low;
        if (upMove > downMove && upMove > 0) { plusDM.push(upMove); minusDM.push(0); }
        else if (downMove > upMove && downMove > 0) { plusDM.push(0); minusDM.push(downMove); }
        else { plusDM.push(0); minusDM.push(0); }
    }
    if (tr.length < period) return null;
    const trSMA = calculateSMA(tr, period);
    if (trSMA === 0) return null;
    const plusDI = calculateSMA(plusDM, period) / trSMA * 100;
    const minusDI = calculateSMA(minusDM, period) / trSMA * 100;
    return Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;
}

function calculateOBV(closes, volumes) {
    if (closes.length < 2 || volumes.length < 2) return 0;
    let obv = 0;
    for (let i = 1; i < closes.length; i++) {
        if (closes[i] > closes[i - 1]) obv += volumes[i] || 0;
        else if (closes[i] < closes[i - 1]) obv -= volumes[i] || 0;
    }
    return obv;
}

function calculateATR(highs, lows, closes, period = 14) {
    if (highs.length < period + 1) return null;
    const tr = [];
    for (let i = 1; i < closes.length; i++) {
        tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    }
    if (tr.length < period) return null;
    return calculateSMA(tr, period);
}

function calculateFibonacciLevels(high, low) {
    const diff = high - low;
    return {
        level0: high,
        level0_236: high - diff * 0.236,
        level0_382: high - diff * 0.382,
        level0_5: high - diff * 0.5,
        level0_618: high - diff * 0.618,
        level1: low
    };
}

// ============================================
//  СВЕЧНЫЕ ПАТТЕРНЫ
// ============================================
function detectCandlePatterns(candle, prevCandle) {
    const patterns = [];
    const body = Math.abs(candle.close - candle.open);
    const range = candle.high - candle.low;
    const bodyPercent = range > 0 ? body / range : 0;

    if (bodyPercent < 0.3 && (candle.low - Math.min(candle.open, candle.close)) > 2 * body) patterns.push('hammer');
    if (bodyPercent < 0.3 && (candle.high - Math.max(candle.open, candle.close)) > 2 * body) patterns.push('hanging_man');
    if (prevCandle && candle.close > candle.open && prevCandle.close < prevCandle.open &&
        candle.open < prevCandle.close && candle.close > prevCandle.open) patterns.push('bullish_engulfing');
    if (prevCandle && candle.close < candle.open && prevCandle.close > prevCandle.open &&
        candle.open > prevCandle.close && candle.close < prevCandle.open) patterns.push('bearish_engulfing');
    if (bodyPercent < 0.1) patterns.push('doji');
    return patterns;
}

// ============================================
//  SMART MONEY CONCEPTS
// ============================================
function analyzeSMC(highs, lows, closes) {
    const signals = { breakOfStructure: null, fairValueGap: null };
    if (highs.length < 20 || lows.length < 20) return signals;
    
    const lastHigh = highs[highs.length - 1];
    const prevHigh = highs[highs.length - 2];
    const lastLow = lows[lows.length - 1];
    const prevLow = lows[lows.length - 2];
    
    if (lastHigh > prevHigh && lastLow > prevLow) signals.breakOfStructure = 'bullish';
    else if (lastHigh < prevHigh && lastLow < prevLow) signals.breakOfStructure = 'bearish';
    
    if (highs.length > 3 && closes.length > 2) {
        const gapHigh = Math.max(highs[highs.length - 3], highs[highs.length - 1]);
        const gapLow = Math.min(lows[highs.length - 3], lows[highs.length - 1]);
        const prevClose = closes[closes.length - 2];
        if (prevClose > gapHigh) signals.fairValueGap = 'bullish_fvg';
        else if (prevClose < gapLow) signals.fairValueGap = 'bearish_fvg';
    }
    return signals;
}

function analyzeNewsSentiment(news) {
    if (!news || news.length === 0) return 'neutral';
    const positiveWords = ['bull', 'up', 'gain', 'rise', 'surge', 'rally', 'positive', 'growth'];
    const negativeWords = ['bear', 'down', 'fall', 'drop', 'crash', 'decline', 'negative', 'loss'];
    let score = 0;
    for (const article of news) {
        const text = (article.title + ' ' + (article.description || '')).toLowerCase();
        positiveWords.forEach(w => { if (text.includes(w)) score++; });
        negativeWords.forEach(w => { if (text.includes(w)) score--; });
    }
    if (score > 2) return 'positive';
    if (score < -2) return 'negative';
    return 'neutral';
}

// ============================================
//  ГЕНЕРАЦИЯ СИГНАЛА (ПОЛНОСТЬЮ БЕЗ LOW)
// ============================================
function generateSignal(symbol, prices, extras = {}) {
    if (!prices || prices.length < 30) return null;

    const lastPrice = prices[prices.length - 1];
    const highs = extras.highs || prices.map(p => p * 1.001);
    const lows = extras.lows || prices.map(p => p * 0.999);
    const volumes = extras.volumes || prices.map(() => Math.random() * 1000000);
    const news = extras.news || [];

    const rsi = calculateRSI(prices);
    const macd = calculateMACD(prices);
    const bollinger = calculateBollingerBands(prices);
    const sma50 = calculateSMA(prices, 50);
    const sma200 = calculateSMA(prices, 200);
    const stochastic = calculateStochastic(highs, lows, prices);
    const ichimoku = calculateIchimoku(highs, lows);
    const adx = calculateADX(highs, lows, prices);
    const obv = calculateOBV(prices, volumes);

    const candle = { open: prices[prices.length - 2], high: highs[highs.length - 1], low: lows[lows.length - 1], close: lastPrice };
    const prevCandle = { open: prices[prices.length - 3], high: highs[highs.length - 2], low: lows[lows.length - 2], close: prices[prices.length - 2] };
    const patterns = detectCandlePatterns(candle, prevCandle);

    const smc = analyzeSMC(highs, lows, prices);
    const sentiment = analyzeNewsSentiment(news);

    let longScore = 0, shortScore = 0;
    const reasons = [];

    if (rsi !== null) {
        if (rsi < 30) { longScore += 2; reasons.push(`RSI перепродан (${rsi.toFixed(1)})`); }
        if (rsi > 70) { shortScore += 2; reasons.push(`RSI перекуплен (${rsi.toFixed(1)})`); }
    }
    if (macd !== null) {
        if (macd.histogram > 0) { longScore += 2; reasons.push('MACD бычий'); }
        if (macd.histogram < 0) { shortScore += 2; reasons.push('MACD медвежий'); }
    }
    if (bollinger !== null) {
        if (lastPrice < bollinger.lower) { longScore += 1; reasons.push('Цена ниже BB'); }
        if (lastPrice > bollinger.upper) { shortScore += 1; reasons.push('Цена выше BB'); }
    }
    if (sma50 !== null && sma200 !== null) {
        if (sma50 > sma200) { longScore += 1; reasons.push('SMA 50 > 200'); }
        if (sma50 < sma200) { shortScore += 1; reasons.push('SMA 50 < 200'); }
    }
    if (stochastic !== null) {
        if (stochastic.k < 20) { longScore += 1; reasons.push('Stoch перепродан'); }
        if (stochastic.k > 80) { shortScore += 1; reasons.push('Stoch перекуплен'); }
    }
    if (ichimoku !== null) {
        if (lastPrice > ichimoku.spanA && lastPrice > ichimoku.spanB) { longScore += 1; reasons.push('Цена выше облака'); }
        if (lastPrice < ichimoku.spanA && lastPrice < ichimoku.spanB) { shortScore += 1; reasons.push('Цена ниже облака'); }
    }
    if (adx !== null && adx > 25) {
        if (longScore > shortScore) reasons.push(`Сильный тренд (ADX ${adx.toFixed(1)})`);
    }
    if (obv > 0) { longScore += 1; reasons.push('OBV растёт'); }
    if (obv < 0) { shortScore += 1; reasons.push('OBV падает'); }

    if (patterns.includes('bullish_engulfing') || patterns.includes('hammer')) {
        longScore += 2;
        reasons.push(`Паттерн: ${patterns.join(', ')}`);
    }
    if (patterns.includes('bearish_engulfing') || patterns.includes('hanging_man')) {
        shortScore += 2;
        reasons.push(`Паттерн: ${patterns.join(', ')}`);
    }

    if (smc.breakOfStructure === 'bullish') { longScore += 2; reasons.push('SMC: BOS бычий'); }
    if (smc.breakOfStructure === 'bearish') { shortScore += 2; reasons.push('SMC: BOS медвежий'); }
    if (smc.fairValueGap === 'bullish_fvg') { longScore += 1; reasons.push('SMC: FVG бычий'); }
    if (smc.fairValueGap === 'bearish_fvg') { shortScore += 1; reasons.push('SMC: FVG медвежий'); }

    if (sentiment === 'positive') { longScore += 1; reasons.push('Новости позитивные'); }
    if (sentiment === 'negative') { shortScore += 1; reasons.push('Новости негативные'); }

    // ===== НОВАЯ ЛОГИКА: ТОЛЬКО MEDIUM И HIGH =====
    const threshold = 3;
    let side = null;
    let confidence = null;

    if (longScore - shortScore >= threshold) {
        side = 'LONG';
        const diff = longScore - shortScore;
        if (diff >= 5) confidence = 'high';
        else if (diff >= 3) confidence = 'medium';
    } else if (shortScore - longScore >= threshold) {
        side = 'SHORT';
        const diff = shortScore - longScore;
        if (diff >= 5) confidence = 'high';
        else if (diff >= 3) confidence = 'medium';
    }

    if (!side || !confidence) return null;

    return {
        symbol,
        side,
        entry: lastPrice,
        confidence,
        reasons: reasons.slice(0, 7),
        rsi: rsi !== null ? parseFloat(rsi.toFixed(1)) : null,
        macd: macd !== null ? parseFloat(macd.histogram.toFixed(6)) : null,
        smc: smc,
        timestamp: new Date().toISOString()
    };
}

module.exports = {
    generateSignal,
    calculateRSI,
    calculateMACD,
    calculateSMA,
    calculateBollingerBands,
    calculateStochastic,
    calculateIchimoku,
    calculateADX,
    calculateOBV,
    calculateATR,
    calculateFibonacciLevels,
    detectCandlePatterns,
    analyzeSMC,
    analyzeNewsSentiment,
    SYMBOLS,
    SYMBOLS_HOT,
    SYMBOLS_COLD
};
