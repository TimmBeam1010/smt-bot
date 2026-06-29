const axios = require('axios');

// ============================================
//  КЕШИРОВАНИЕ ЦЕН (В ПАМЯТИ)
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
    'SHIB-USDT', 'LTC-USDT', 'AVAX-USDT', 'UNI-USDT', 'ATOM-USDT',
    'LINK-USDT', 'ETC-USDT', 'XLM-USDT', 'BCH-USDT', 'ALGO-USDT'
];

const SYMBOLS_COLD = [
    'VET-USDT', 'ICP-USDT', 'FIL-USDT', 'EGLD-USDT', 'THETA-USDT',
    'HNT-USDT', 'XMR-USDT', 'ARB-USDT', 'MKR-USDT', 'AAVE-USDT',
    'APE-USDT', 'QNT-USDT', 'FTM-USDT', 'RNDR-USDT', 'SNX-USDT',
    'MANA-USDT', 'SAND-USDT', 'GALA-USDT', 'AXS-USDT', 'ENJ-USDT',
    'BONK-USDT', 'DOGS-USDT', 'PEPE-USDT', 'WIF-USDT', 'FLOKI-USDT',
    'NOT-USDT', 'JUP-USDT', 'JTO-USDT', 'PYTH-USDT', 'TIA-USDT',
    'SEI-USDT', 'SUI-USDT', 'APT-USDT', 'OP-USDT', 'LDO-USDT',
    'AR-USDT', 'RUNE-USDT', 'KAS-USDT', 'CFX-USDT', 'CORE-USDT',
    'CRV-USDT', 'CVX-USDT', 'BAL-USDT', 'YFI-USDT', 'COMP-USDT',
    'SUSHI-USDT', '1INCH-USDT', 'CAKE-USDT', 'BAKE-USDT', 'DODO-USDT',
    'GRT-USDT', 'LPT-USDT', 'RLC-USDT', 'IOTX-USDT', 'IOTA-USDT',
    'NEO-USDT', 'ONT-USDT', 'VTHO-USDT', 'HOT-USDT', 'STX-USDT',
    'ILV-USDT', 'YGG-USDT', 'ALICE-USDT', 'TLM-USDT', 'SIDUS-USDT',
    'MEME-USDT', 'PEPE2-USDT', 'WOJAK-USDT', 'TOSHI-USDT',
    'USDC-USDT', 'DAI-USDT', 'FDUSD-USDT'
];

const SYMBOLS = [...SYMBOLS_HOT, ...SYMBOLS_COLD];

// ============================================
//  КОНФИГУРАЦИЯ БИРЖ (ИСПРАВЛЕННАЯ)
// ============================================
const EXCHANGES = {
    binance: {
        name: 'Binance',
        url: (symbol) => `https://api.binance.com/api/v3/ticker/price?symbol=${symbol.replace('-', '')}`,
        parse: (data) => {
            if (data && data.price) {
                return parseFloat(data.price);
            }
            return null;
        }
    },
    bybit: {
        name: 'Bybit',
        url: (symbol) => `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol.replace('-', '')}`,
        parse: (data) => {
            try {
                if (data?.result?.list?.length > 0) {
                    const ticker = data.result.list[0];
                    if (ticker?.lastPrice) {
                        return parseFloat(ticker.lastPrice);
                    }
                }
                return null;
            } catch (e) {
                return null;
            }
        }
    },
    okx: {
        name: 'OKX',
        url: (symbol) => `https://www.okx.com/api/v5/market/ticker?instId=${symbol.replace('-', '')}`,
        parse: (data) => {
            try {
                if (data?.data?.length > 0) {
                    const ticker = data.data[0];
                    if (ticker?.last) {
                        return parseFloat(ticker.last);
                    }
                }
                return null;
            } catch (e) {
                return null;
            }
        }
    },
    bingx: {
        name: 'BingX',
        url: (symbol) => `https://open-api.bingx.com/openApi/spot/v1/ticker/price?symbol=${symbol.replace('-', '_')}`,
        parse: (data) => {
            try {
                if (data?.data?.length > 0) {
                    const trades = data.data[0]?.trades;
                    if (trades?.length > 0 && trades[0]?.price) {
                        return parseFloat(trades[0].price);
                    }
                }
                if (data?.price) {
                    return parseFloat(data.price);
                }
                return null;
            } catch (e) {
                return null;
            }
        }
    }
};

// ============================================
//  ФУНКЦИИ ДЛЯ РАБОТЫ С ЦЕНАМИ
// ============================================
async function fetchPriceFromExchange(symbol, exchange) {
    const cached = getCachedPrice(symbol, exchange);
    if (cached !== null) {
        return cached;
    }

    try {
        const config = EXCHANGES[exchange];
        if (!config) return null;

        const url = config.url(symbol);
        const response = await axios.get(url, { timeout: 5000 });
        const price = config.parse(response.data);

        if (price && !isNaN(price) && price > 0) {
            setCachedPrice(symbol, exchange, price);
            return price;
        }
        return null;
    } catch (error) {
        console.error(`❌ Ошибка ${exchange} для ${symbol}:`, error.message);
        return null;
    }
}

async function getAggregatedPrice(symbol, exchanges = ['binance', 'bybit', 'bingx'], method = 'median', useCache = true) {
    const results = [];

    for (const exchange of exchanges) {
        let price = null;
        if (useCache) {
            price = getCachedPrice(symbol, exchange);
        }
        if (price === null) {
            price = await fetchPriceFromExchange(symbol, exchange);
        }
        if (price !== null) {
            results.push({ exchange, price });
        }
    }

    if (results.length === 0) {
        return null;
    }

    const prices = results.map(r => r.price);
    let aggregatedPrice = 0;

    switch (method) {
        case 'median':
            const sorted = [...prices].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            aggregatedPrice = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
            break;
        case 'simple':
        default:
            aggregatedPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
            break;
    }

    return {
        price: parseFloat(aggregatedPrice.toFixed(8)),
        sources: results
    };
}

async function getSmartPrice(symbol) {
    const isHot = SYMBOLS_HOT.includes(symbol);
    const exchanges = isHot ? ['binance', 'bybit', 'bingx'] : ['binance'];
    const method = isHot ? 'median' : 'simple';

    const result = await getAggregatedPrice(symbol, exchanges, method, true);
    if (result) {
        return result.price;
    }
    return null;
}

async function getSmartPrices(symbols = SYMBOLS) {
    const results = {};
    const hotSymbols = symbols.filter(s => SYMBOLS_HOT.includes(s));
    const coldSymbols = symbols.filter(s => SYMBOLS_COLD.includes(s));

    for (const symbol of hotSymbols) {
        const price = await getSmartPrice(symbol);
        if (price !== null) {
            results[symbol] = price;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    for (const symbol of coldSymbols) {
        const price = await fetchPriceFromExchange(symbol, 'binance');
        if (price !== null) {
            results[symbol] = price;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    return results;
}

async function getPrice(symbol) {
    return getSmartPrice(symbol);
}

async function getPrices(symbols) {
    return getSmartPrices(symbols);
}

// ============================================
//  ВСЕ ИНДИКАТОРЫ
// ============================================
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;
    const deltas = [];
    for (let i = 1; i < prices.length; i++) {
        deltas.push(prices[i] - prices[i - 1]);
    }
    const gains = deltas.map(d => d > 0 ? d : 0);
    const losses = deltas.map(d => d < 0 ? -d : 0);
    const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
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
    const histogram = macdLine - signalLine;
    return { macd: macdLine, signal: signalLine, histogram: histogram };
}

function calculateEMA(data, period) {
    if (data.length < period) {
        return data.reduce((a, b) => a + b, 0) / data.length;
    }
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
        ema = data[i] * k + ema * (1 - k);
    }
    return ema;
}

function calculateSMA(data, period) {
    if (data.length < period) return null;
    const slice = data.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateBollingerBands(prices, period = 20, stdDev = 2) {
    if (prices.length < period) return null;
    const slice = prices.slice(-period);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const squaredDiffs = slice.map(p => Math.pow(p - sma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
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
        if (high - low === 0) {
            kValues.push(50);
        } else {
            kValues.push((close - low) / (high - low) * 100);
        }
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
        const high = highs[i];
        const low = lows[i];
        const prevHigh = highs[i - 1];
        const prevLow = lows[i - 1];
        const prevClose = closes[i - 1];
        const tr1 = high - low;
        const tr2 = Math.abs(high - prevClose);
        const tr3 = Math.abs(low - prevClose);
        tr.push(Math.max(tr1, tr2, tr3));
        const upMove = high - prevHigh;
        const downMove = prevLow - low;
        if (upMove > downMove && upMove > 0) {
            plusDM.push(upMove);
            minusDM.push(0);
        } else if (downMove > upMove && downMove > 0) {
            plusDM.push(0);
            minusDM.push(downMove);
        } else {
            plusDM.push(0);
            minusDM.push(0);
        }
    }
    if (tr.length < period) return null;
    const trSMA = calculateSMA(tr, period);
    const plusSMA = calculateSMA(plusDM, period);
    const minusSMA = calculateSMA(minusDM, period);
    if (trSMA === 0) return null;
    const plusDI = plusSMA / trSMA * 100;
    const minusDI = minusSMA / trSMA * 100;
    const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;
    return dx;
}

function calculateOBV(closes, volumes) {
    if (closes.length < 2 || volumes.length < 2) return 0;
    let obv = 0;
    for (let i = 1; i < closes.length; i++) {
        if (closes[i] > closes[i - 1]) {
            obv += volumes[i] || 0;
        } else if (closes[i] < closes[i - 1]) {
            obv -= volumes[i] || 0;
        }
    }
    return obv;
}

function calculateATR(highs, lows, closes, period = 14) {
    if (highs.length < period + 1) return null;
    const tr = [];
    for (let i = 1; i < closes.length; i++) {
        const tr1 = highs[i] - lows[i];
        const tr2 = Math.abs(highs[i] - closes[i - 1]);
        const tr3 = Math.abs(lows[i] - closes[i - 1]);
        tr.push(Math.max(tr1, tr2, tr3));
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
function detectCandlePatterns(candle, prevCandle, prevPrevCandle) {
    const patterns = [];
    const body = Math.abs(candle.close - candle.open);
    const range = candle.high - candle.low;
    const bodyPercent = range > 0 ? body / range : 0;

    if (bodyPercent < 0.3 && (candle.low - Math.min(candle.open, candle.close)) > 2 * body) {
        patterns.push('hammer');
    }
    if (bodyPercent < 0.3 && (candle.high - Math.max(candle.open, candle.close)) > 2 * body) {
        patterns.push('hanging_man');
    }
    if (prevCandle && candle.close > candle.open && prevCandle.close < prevCandle.open &&
        candle.open < prevCandle.close && candle.close > prevCandle.open) {
        patterns.push('bullish_engulfing');
    }
    if (prevCandle && candle.close < candle.open && prevCandle.close > prevCandle.open &&
        candle.open > prevCandle.close && candle.close < prevCandle.open) {
        patterns.push('bearish_engulfing');
    }
    if (bodyPercent < 0.1) {
        patterns.push('doji');
    }
    if (prevPrevCandle && prevCandle && prevPrevCandle.close < prevPrevCandle.open &&
        prevCandle.bodyPercent < 0.1 && candle.close > candle.open &&
        candle.close > (prevPrevCandle.open + prevPrevCandle.close) / 2) {
        patterns.push('morning_star');
    }
    if (prevPrevCandle && prevCandle && prevPrevCandle.close > prevPrevCandle.open &&
        prevCandle.bodyPercent < 0.1 && candle.close < candle.open &&
        candle.close < (prevPrevCandle.open + prevPrevCandle.close) / 2) {
        patterns.push('evening_star');
    }
    if (prevPrevCandle && prevCandle &&
        prevPrevCandle.close > prevPrevCandle.open &&
        prevCandle.close > prevCandle.open &&
        candle.close > candle.open &&
        prevCandle.close > prevPrevCandle.close &&
        candle.close > prevCandle.close) {
        patterns.push('three_white_soldiers');
    }
    if (prevPrevCandle && prevCandle &&
        prevPrevCandle.close < prevPrevCandle.open &&
        prevCandle.close < prevCandle.open &&
        candle.close < candle.open &&
        prevCandle.close < prevPrevCandle.close &&
        candle.close < prevCandle.close) {
        patterns.push('three_black_crows');
    }
    return patterns;
}

// ============================================
//  SMART MONEY CONCEPTS
// ============================================
function analyzeSMC(highs, lows, closes) {
    const signals = {};
    if (highs.length < 20 || lows.length < 20) {
        return { breakOfStructure: null, fairValueGap: null };
    }
    const lastHigh = highs[highs.length - 1];
    const prevHigh = highs[highs.length - 2];
    const lastLow = lows[lows.length - 1];
    const prevLow = lows[lows.length - 2];
    signals.breakOfStructure = null;
    if (lastHigh > prevHigh && lastLow > prevLow) {
        signals.breakOfStructure = 'bullish';
    } else if (lastHigh < prevHigh && lastLow < prevLow) {
        signals.breakOfStructure = 'bearish';
    }
    signals.fairValueGap = null;
    if (highs.length > 3) {
        const gapHigh = Math.max(highs[highs.length - 3], highs[highs.length - 1]);
        const gapLow = Math.min(lows[highs.length - 3], lows[highs.length - 1]);
        const prevClose = closes[closes.length - 2];
        if (prevClose > gapHigh) {
            signals.fairValueGap = 'bullish_fvg';
        } else if (prevClose < gapLow) {
            signals.fairValueGap = 'bearish_fvg';
        }
    }
    return signals;
}

// ============================================
//  НОВОСТНОЙ ФОН
// ============================================
function analyzeNewsSentiment(news) {
    if (!news || news.length === 0) return 'neutral';
    const positiveWords = ['bull', 'up', 'gain', 'rise', 'surge', 'rally', 'positive', 'growth', 'profit', 'green', 'upward'];
    const negativeWords = ['bear', 'down', 'fall', 'drop', 'crash', 'decline', 'negative', 'loss', 'red', 'downward', 'crisis'];
    let score = 0;
    for (const article of news) {
        const text = (article.title + ' ' + (article.description || '')).toLowerCase();
        for (const word of positiveWords) {
            if (text.includes(word)) score += 1;
        }
        for (const word of negativeWords) {
            if (text.includes(word)) score -= 1;
        }
    }
    if (score > 2) return 'positive';
    if (score < -2) return 'negative';
    return 'neutral';
}

// ============================================
//  ГЕНЕРАЦИЯ СИГНАЛА
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
    const atr = calculateATR(highs, lows, prices);

    const candle = { open: prices[prices.length - 2], high: highs[highs.length - 1], low: lows[lows.length - 1], close: lastPrice, bodyPercent: 0 };
    const prevCandle = { open: prices[prices.length - 3], high: highs[highs.length - 2], low: lows[lows.length - 2], close: prices[prices.length - 2], bodyPercent: 0 };
    const prevPrevCandle = { open: prices[prices.length - 4], high: highs[highs.length - 3], low: lows[lows.length - 3], close: prices[prices.length - 3], bodyPercent: 0 };
    const patterns = detectCandlePatterns(candle, prevCandle, prevPrevCandle);

    const smc = analyzeSMC(highs, lows, prices);
    const sentiment = analyzeNewsSentiment(news);

    let longScore = 0;
    let shortScore = 0;
    const reasons = [];

    if (rsi !== null) {
        if (rsi < 30) { longScore += 2; reasons.push(`RSI перепродан (${rsi.toFixed(1)})`); }
        if (rsi > 70) { shortScore += 2; reasons.push(`RSI перекуплен (${rsi.toFixed(1)})`); }
    }
    if (macd !== null) {
        if (macd.histogram > 0 && macd.macd > macd.signal) {
            longScore += 2;
            reasons.push('MACD бычий');
        }
        if (macd.histogram < 0 && macd.macd < macd.signal) {
            shortScore += 2;
            reasons.push('MACD медвежий');
        }
    }
    if (bollinger !== null) {
        if (lastPrice < bollinger.lower) { longScore += 1; reasons.push('Цена ниже нижней полосы Боллинджера'); }
        if (lastPrice > bollinger.upper) { shortScore += 1; reasons.push('Цена выше верхней полосы Боллинджера'); }
    }
    if (sma50 !== null && sma200 !== null) {
        if (sma50 > sma200) { longScore += 1; reasons.push('SMA 50 > SMA 200 (золотой крест)'); }
        if (sma50 < sma200) { shortScore += 1; reasons.push('SMA 50 < SMA 200 (смертельный крест)'); }
    }
    if (stochastic !== null) {
        if (stochastic.k < 20) { longScore += 1; reasons.push('Стохастик перепродан'); }
        if (stochastic.k > 80) { shortScore += 1; reasons.push('Стохастик перекуплен'); }
    }
    if (ichimoku !== null) {
        if (lastPrice > ichimoku.spanA && lastPrice > ichimoku.spanB) {
            longScore += 1;
            reasons.push('Цена выше облака Ишимоку');
        }
        if (lastPrice < ichimoku.spanA && lastPrice < ichimoku.spanB) {
            shortScore += 1;
            reasons.push('Цена ниже облака Ишимоку');
        }
    }
    if (adx !== null && adx > 25) {
        if (longScore > shortScore) { reasons.push(`Сильный тренд (ADX ${adx.toFixed(1)})`); }
    }
    if (obv > 0) { longScore += 1; reasons.push('OBV растёт (подтверждение бычьего тренда)'); }
    if (obv < 0) { shortScore += 1; reasons.push('OBV падает (подтверждение медвежьего тренда)'); }

    if (patterns.includes('bullish_engulfing') || patterns.includes('hammer') ||
        patterns.includes('morning_star') || patterns.includes('three_white_soldiers')) {
        longScore += 2;
        reasons.push(`Свечной паттерн: ${patterns.join(', ')}`);
    }
    if (patterns.includes('bearish_engulfing') || patterns.includes('hanging_man') ||
        patterns.includes('evening_star') || patterns.includes('three_black_crows')) {
        shortScore += 2;
        reasons.push(`Свечной паттерн: ${patterns.join(', ')}`);
    }

    if (smc.breakOfStructure === 'bullish') {
        longScore += 2;
        reasons.push('SMC: Break of Structure (бычий)');
    }
    if (smc.breakOfStructure === 'bearish') {
        shortScore += 2;
        reasons.push('SMC: Break of Structure (медвежий)');
    }
    if (smc.fairValueGap === 'bullish_fvg') {
        longScore += 1;
        reasons.push('SMC: Fair Value Gap (бычий)');
    }
    if (smc.fairValueGap === 'bearish_fvg') {
        shortScore += 1;
        reasons.push('SMC: Fair Value Gap (медвежий)');
    }

    if (sentiment === 'positive') { longScore += 1; reasons.push('Положительный новостной фон'); }
    if (sentiment === 'negative') { shortScore += 1; reasons.push('Отрицательный новостной фон'); }

    const threshold = 3;
    let side = null;
    let confidence = 'low';

    if (longScore - shortScore >= threshold) {
        side = 'LONG';
        confidence = longScore - shortScore >= 6 ? 'high' : 'medium';
    } else if (shortScore - longScore >= threshold) {
        side = 'SHORT';
        confidence = shortScore - longScore >= 6 ? 'high' : 'medium';
    } else {
        return null;
    }

    return {
        symbol,
        side,
        entry: lastPrice,
        confidence,
        reasons: reasons.slice(0, 5),
        rsi: rsi !== null ? parseFloat(rsi.toFixed(1)) : null,
        macd: macd !== null ? parseFloat(macd.histogram.toFixed(6)) : null,
        bollinger: bollinger !== null ? {
            upper: parseFloat(bollinger.upper.toFixed(4)),
            middle: parseFloat(bollinger.middle.toFixed(4)),
            lower: parseFloat(bollinger.lower.toFixed(4))
        } : null,
        sma50: sma50 !== null ? parseFloat(sma50.toFixed(4)) : null,
        sma200: sma200 !== null ? parseFloat(sma200.toFixed(4)) : null,
        stochastic: stochastic !== null ? { k: parseFloat(stochastic.k.toFixed(1)), d: parseFloat(stochastic.d.toFixed(1)) } : null,
        patterns: patterns.length > 0 ? patterns : null,
        smc: smc,
        timestamp: new Date().toISOString()
    };
}

// ============================================
//  МНОГОПОЛЬЗОВАТЕЛЬСКАЯ ЛОГИКА
// ============================================
const userExchangesCache = new Map();
let userCacheTimestamp = 0;
const USER_CACHE_TTL = 60000;

async function getAllUserExchanges(supabase) {
    const now = Date.now();
    if (userCacheTimestamp > 0 && (now - userCacheTimestamp) < USER_CACHE_TTL) {
        return userExchangesCache;
    }

    try {
        const { data: users, error } = await supabase
            .from('users')
            .select('id, connected_exchanges')
            .eq('is_active', true);

        if (error) {
            console.error('❌ Ошибка получения списка пользователей:', error);
            return userExchangesCache;
        }

        userExchangesCache.clear();
        for (const user of users) {
            const exchanges = user.connected_exchanges || [];
            if (Array.isArray(exchanges) && exchanges.length > 0) {
                const cleanExchanges = exchanges.map(e => e.trim()).filter(e => e.length > 0);
                if (cleanExchanges.length > 0) {
                    userExchangesCache.set(user.id, cleanExchanges);
                } else {
                    userExchangesCache.set(user.id, ['binance', 'bybit', 'okx']);
                }
            } else {
                userExchangesCache.set(user.id, ['binance', 'bybit', 'okx']);
            }
        }

        userCacheTimestamp = now;
        console.log(`✅ Кеш бирж обновлён: ${userExchangesCache.size} пользователей`);
        return userExchangesCache;

    } catch (err) {
        console.error('❌ Ошибка получения бирж пользователей:', err);
        return userExchangesCache;
    }
}

async function getUserAggregatedPrice(userId, symbol, supabase, defaultExchanges = ['binance', 'bybit', 'okx']) {
    try {
        const userExchangesMap = await getAllUserExchanges(supabase);
        let exchanges = userExchangesMap.get(userId);

        if (!exchanges || !Array.isArray(exchanges) || exchanges.length === 0) {
            exchanges = defaultExchanges;
        }

        const result = await getAggregatedPrice(symbol, exchanges, 'median', true);
        if (result) {
            return result;
        }

        console.warn(`⚠️ Не удалось получить цену с бирж пользователя ${userId}, использую дефолтные`);
        return getAggregatedPrice(symbol, defaultExchanges, 'median', true);

    } catch (err) {
        console.error(`❌ Ошибка получения данных для пользователя ${userId}:`, err.message);
        return getAggregatedPrice(symbol, defaultExchanges, 'median', true);
    }
}

// ============================================
//  ЭКСПОРТ
// ============================================

module.exports = {
    SYMBOLS,
    SYMBOLS_HOT,
    SYMBOLS_COLD,
    EXCHANGES,
    getPrice,
    getPrices,
    getSmartPrice,
    getSmartPrices,
    getAggregatedPrice,
    fetchPriceFromExchange,
    getAllUserExchanges,
    getUserAggregatedPrice,
    calculateRSI,
    calculateMACD,
    calculateEMA,
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
    generateSignal
};