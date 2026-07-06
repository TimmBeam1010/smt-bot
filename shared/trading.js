const trading = {};

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====

function calculateSMA(data, period) {
    if (data.length < period) return data[data.length - 1] || 0;
    const sum = data.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
}

function calculateEMA(data, period) {
    if (data.length < period) return data[data.length - 1] || 0;
    const k = 2 / (period + 1);
    let ema = data[0];
    for (let i = 1; i < data.length; i++) {
        ema = data[i] * k + ema * (1 - k);
    }
    return ema;
}

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateMACD(prices, fast = 12, slow = 26, signal = 9) {
    if (prices.length < slow + signal) return { macd: 0, signal: 0, histogram: 0 };
    const emaFast = calculateEMA(prices, fast);
    const emaSlow = calculateEMA(prices, slow);
    const macd = emaFast - emaSlow;
    const macdSignal = calculateEMA([macd], signal);
    return { macd, signal: macdSignal, histogram: macd - macdSignal };
}

function calculateBollingerBands(prices, period = 20, multiplier = 2) {
    if (prices.length < period) {
        const last = prices[prices.length - 1] || 0;
        return { upper: last * 1.02, middle: last, lower: last * 0.98 };
    }
    const slice = prices.slice(-period);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const squaredDiffs = slice.map(p => Math.pow(p - sma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    const stdDev = Math.sqrt(variance);
    return { upper: sma + multiplier * stdDev, middle: sma, lower: sma - multiplier * stdDev };
}

function calculateATR(highs, lows, closes, period = 14) {
    if (highs.length < period || lows.length < period || closes.length < period) {
        return closes[closes.length - 1] * 0.02;
    }
    const tr = [];
    for (let i = 1; i < highs.length; i++) {
        const high = highs[i];
        const low = lows[i];
        const prevClose = closes[i - 1];
        tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
    let atr = 0;
    for (let i = 0; i < period && i < tr.length; i++) {
        atr += tr[tr.length - 1 - i];
    }
    atr = atr / Math.min(period, tr.length);
    return atr;
}

// ===== ОСНОВНАЯ ФУНКЦИЯ ГЕНЕРАЦИИ СИГНАЛА =====

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
    const atr = calculateATR(highs, lows, prices, 14);

    let side = 'NEUTRAL';
    let confidence = 'low';
    const reasons = [];
    const entry = lastPrice;

    // ===== СИГНАЛЫ =====

    // RSI
    if (rsi < 30) {
        side = 'LONG';
        reasons.push(`RSI (${rsi.toFixed(1)}) ниже 30 — перепроданность`);
        confidence = 'medium';
    } else if (rsi > 70) {
        side = 'SHORT';
        reasons.push(`RSI (${rsi.toFixed(1)}) выше 70 — перекупленность`);
        confidence = 'medium';
    } else if (rsi > 40 && rsi < 60) {
        reasons.push(`RSI (${rsi.toFixed(1)}) в нейтральной зоне`);
    }

    // MACD
    if (macd.macd > macd.signal && macd.macd > 0) {
        if (side === 'LONG') {
            reasons.push('MACD бычий');
            confidence = 'high';
        } else if (side === 'NEUTRAL') {
            side = 'LONG';
            reasons.push('MACD бычий');
            confidence = 'medium';
        }
    } else if (macd.macd < macd.signal && macd.macd < 0) {
        if (side === 'SHORT') {
            reasons.push('MACD медвежий');
            confidence = 'high';
        } else if (side === 'NEUTRAL') {
            side = 'SHORT';
            reasons.push('MACD медвежий');
            confidence = 'medium';
        }
    } else {
        reasons.push('MACD нейтральный');
    }

    // Bollinger Bands
    if (lastPrice < bollinger.lower) {
        if (side === 'LONG') {
            reasons.push('Цена ниже нижней полосы Боллинджера');
            confidence = 'high';
        } else if (side === 'NEUTRAL') {
            side = 'LONG';
            reasons.push('Цена ниже нижней полосы Боллинджера');
            confidence = 'medium';
        }
    } else if (lastPrice > bollinger.upper) {
        if (side === 'SHORT') {
            reasons.push('Цена выше верхней полосы Боллинджера');
            confidence = 'high';
        } else if (side === 'NEUTRAL') {
            side = 'SHORT';
            reasons.push('Цена выше верхней полосы Боллинджера');
            confidence = 'medium';
        }
    }

    // SMA
    if (sma50 > sma200 && side === 'LONG') {
        reasons.push('50 SMA выше 200 SMA — бычий тренд');
        confidence = 'high';
    } else if (sma50 < sma200 && side === 'SHORT') {
        reasons.push('50 SMA ниже 200 SMA — медвежий тренд');
        confidence = 'high';
    }

    // Дополнительное усиление для HIGH
    if (confidence === 'high') {
        if (side === 'LONG' && rsi < 35) confidence = 'high';
        if (side === 'SHORT' && rsi > 65) confidence = 'high';
    }

    if (side === 'NEUTRAL') return null;

    const signal = {
        symbol,
        side,
        entry,
        confidence,
        reasons,
        rsi,
        macd: macd.macd,
        atr: atr
    };

    return signal;
}

module.exports = { 
    calculateSMA, 
    calculateEMA, 
    calculateRSI, 
    calculateMACD, 
    calculateBollingerBands, 
    calculateATR, 
    generateSignal 
};
