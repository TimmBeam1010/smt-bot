// ============================================
//  ЯДРО ТОРГОВОЙ ЛОГИКИ
//  Индикаторы и генерация сигналов
// ============================================

/**
 * Рассчёт RSI (индекс относительной силы)
 * @param {Array} prices - Цены закрытия
 * @param {number} period - Период (по умолчанию 14)
 * @returns {number} Значение RSI (0-100)
 */
function calculateRSI(prices, period = 14) {
    if (!prices || prices.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
        const diff = prices[prices.length - i] - prices[prices.length - i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

/**
 * Рассчёт EMA (экспоненциальное скользящее среднее)
 */
function calculateEMA(data, period) {
    if (data.length < period) return data[data.length - 1] || 0;
    const k = 2 / (period + 1);
    let ema = data[0];
    for (let i = 1; i < data.length; i++) {
        ema = data[i] * k + ema * (1 - k);
    }
    return ema;
}

/**
 * Рассчёт SMA (простое скользящее среднее)
 */
function calculateSMA(data, period) {
    if (data.length < period) return data[data.length - 1] || 0;
    const slice = data.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Рассчёт MACD (12, 26, 9)
 */
function calculateMACD(prices, fast = 12, slow = 26, signal = 9) {
    if (!prices || prices.length < slow + signal) {
        return { macd: 0, signal: 0, histogram: 0 };
    }

    const emaFast = calculateEMA(prices, fast);
    const emaSlow = calculateEMA(prices, slow);
    const macd = emaFast - emaSlow;
    const macdSignal = calculateEMA([macd], signal);

    return {
        macd: macd,
        signal: macdSignal,
        histogram: macd - macdSignal
    };
}

/**
 * Рассчёт Bollinger Bands
 */
function calculateBollingerBands(prices, period = 20, stdDev = 2) {
    if (prices.length < period) {
        return { upper: prices[prices.length - 1] || 0, middle: prices[prices.length - 1] || 0, lower: prices[prices.length - 1] || 0 };
    }

    const slice = prices.slice(-period);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
    const std = Math.sqrt(variance);

    return {
        upper: sma + stdDev * std,
        middle: sma,
        lower: sma - stdDev * std
    };
}

/**
 * Рассчёт ATR (средний истинный диапазон)
 */
function calculateATR(highs, lows, closes, period = 14) {
    if (!highs || !lows || !closes || highs.length < period + 1) {
        return (Math.max(...closes) - Math.min(...closes)) * 0.02;
    }

    const tr = [];
    for (let i = 1; i < highs.length; i++) {
        const hl = highs[i] - lows[i];
        const hc = Math.abs(highs[i] - closes[i - 1]);
        const lc = Math.abs(lows[i] - closes[i - 1]);
        tr.push(Math.max(hl, hc, lc));
    }

    if (tr.length === 0) return 0.02;
    return tr.slice(-period).reduce((a, b) => a + b, 0) / Math.min(period, tr.length);
}

/**
 * Генерация торгового сигнала (ИСПРАВЛЕННАЯ)
 */
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

    // 1. RSI (СТАНДАРТНЫЕ ПОРОГИ)
    if (rsi < 30) {
        side = 'LONG';
        reasons.push(`RSI перепроданность (${rsi.toFixed(1)})`);
        confidence = 'medium';
    } else if (rsi > 70) {
        side = 'SHORT';
        reasons.push(`RSI перекупленность (${rsi.toFixed(1)})`);
        confidence = 'medium';
    } else if (rsi < 40) {
        reasons.push(`RSI близок к перепроданности (${rsi.toFixed(1)})`);
    } else if (rsi > 60) {
        reasons.push(`RSI близок к перекупленности (${rsi.toFixed(1)})`);
    } else {
        reasons.push(`RSI нейтральный (${rsi.toFixed(1)})`);
    }

    // 2. MACD
    if (macd.macd > macd.signal && macd.macd > 0) {
        if (side === 'LONG') {
            reasons.push('MACD бычий (подтверждение)');
            confidence = 'high';
        } else if (side === 'NEUTRAL') {
            side = 'LONG';
            reasons.push('MACD бычий');
            confidence = 'medium';
        }
    } else if (macd.macd < macd.signal && macd.macd < 0) {
        if (side === 'SHORT') {
            reasons.push('MACD медвежий (подтверждение)');
            confidence = 'high';
        } else if (side === 'NEUTRAL') {
            side = 'SHORT';
            reasons.push('MACD медвежий');
            confidence = 'medium';
        }
    }

    // 3. Bollinger Bands
    if (side === 'LONG' && lastPrice < bollinger.lower) {
        reasons.push('Цена ниже нижней полосы Боллинджера');
        confidence = confidence === 'high' ? 'high' : 'medium';
    } else if (side === 'SHORT' && lastPrice > bollinger.upper) {
        reasons.push('Цена выше верхней полосы Боллинджера');
        confidence = confidence === 'high' ? 'high' : 'medium';
    }

    // 4. Скользящие средние
    if (sma50 > sma200) {
        if (side === 'LONG') {
            reasons.push('50 SMA выше 200 SMA (бычий тренд)');
            confidence = confidence === 'high' ? 'high' : 'medium';
        }
    } else if (sma50 < sma200) {
        if (side === 'SHORT') {
            reasons.push('50 SMA ниже 200 SMA (медвежий тренд)');
            confidence = confidence === 'high' ? 'high' : 'medium';
        }
    }

    // 5. Объёмы (если есть)
    if (volumes && volumes.length > 0) {
        const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length);
        const lastVolume = volumes[volumes.length - 1] || 0;
        if (lastVolume > avgVolume * 1.5) {
            reasons.push(`Объём выше среднего в 1.5x (${(lastVolume / avgVolume).toFixed(1)}x)`);
            confidence = confidence === 'high' ? 'high' : 'medium';
        }
    }

    // 6. Поддержка/сопротивление (приблизительно)
    const recentHigh = Math.max(...prices.slice(-20));
    const recentLow = Math.min(...prices.slice(-20));
    if (side === 'LONG' && lastPrice <= recentLow * 1.01) {
        reasons.push('Цена у уровня поддержки');
        confidence = confidence === 'high' ? 'high' : 'medium';
    } else if (side === 'SHORT' && lastPrice >= recentHigh * 0.99) {
        reasons.push('Цена у уровня сопротивления');
        confidence = confidence === 'high' ? 'high' : 'medium';
    }

    // 7. Новости (если есть)
    if (news && news.length > 0) {
        const hasPositive = news.some(n => n.sentiment === 'positive');
        const hasNegative = news.some(n => n.sentiment === 'negative');
        if (side === 'LONG' && hasPositive) {
            reasons.push('Позитивные новости');
            confidence = confidence === 'high' ? 'high' : 'medium';
        } else if (side === 'SHORT' && hasNegative) {
            reasons.push('Негативные новости');
            confidence = confidence === 'high' ? 'high' : 'medium';
        }
    }

    // Если нет сигнала — возвращаем null
    if (side === 'NEUTRAL' || confidence === 'low') {
        return null;
    }

    // Рассчёт стоп-лосса и тейк-профита
    const stopLoss = side === 'LONG'
        ? Math.round((entry - atr * 2) * 10000) / 10000
        : Math.round((entry + atr * 2) * 10000) / 10000;

    const takeProfit = side === 'LONG'
        ? Math.round((entry + atr * 3) * 10000) / 10000
        : Math.round((entry - atr * 3) * 10000) / 10000;

    return {
        symbol,
        side,
        entry: Math.round(entry * 10000) / 10000,
        stopLoss,
        takeProfit,
        confidence,
        reasons,
        rsi: Math.round(rsi * 10) / 10,
        macd: Math.round(macd.macd * 10000) / 10000,
        atr: Math.round(atr * 10000) / 10000,
        timestamp: new Date().toISOString()
    };
}

module.exports = {
    calculateRSI,
    calculateMACD,
    calculateBollingerBands,
    calculateSMA,
    calculateATR,
    generateSignal
};