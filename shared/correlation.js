// ============================================
//  АНАЛИЗ КОРРЕЛЯЦИИ АКТИВОВ
// ============================================

class CorrelationAnalyzer {
    constructor() {
        this.correlations = {};
        this.updateInterval = 60000; // 1 минута
    }

    /**
     * Рассчитать корреляцию между двумя массивами цен
     */
    calculateCorrelation(prices1, prices2) {
        if (prices1.length !== prices2.length || prices1.length < 10) return 0;
        
        const n = prices1.length;
        const mean1 = prices1.reduce((a, b) => a + b, 0) / n;
        const mean2 = prices2.reduce((a, b) => a + b, 0) / n;
        
        let numerator = 0;
        let denom1 = 0;
        let denom2 = 0;
        
        for (let i = 0; i < n; i++) {
            const diff1 = prices1[i] - mean1;
            const diff2 = prices2[i] - mean2;
            numerator += diff1 * diff2;
            denom1 += diff1 * diff1;
            denom2 += diff2 * diff2;
        }
        
        if (denom1 === 0 || denom2 === 0) return 0;
        return numerator / (Math.sqrt(denom1) * Math.sqrt(denom2));
    }

    /**
     * Проверить, является ли сигнал безопасным с учетом корреляции
     */
    isSafeSignal(symbol, signal, positions, correlations) {
        // Проверяем корреляцию с открытыми позициями
        for (const pos of positions) {
            if (pos.symbol === symbol) continue;
            const corr = correlations[`${symbol}-${pos.symbol}`] || 0;
            
            // Если корреляция > 0.7 и позиция уже открыта — сигнал опасен
            if (Math.abs(corr) > 0.7) {
                return {
                    safe: false,
                    reason: `Высокая корреляция с ${pos.symbol} (${(corr * 100).toFixed(0)}%)`,
                    correlation: corr
                };
            }
        }
        
        return { safe: true };
    }

    /**
     * Получить диверсифицированный портфель сигналов
     */
    diversifySignals(signals, positions, correlations, maxCorrelation = 0.7) {
        const selected = [];
        const selectedSymbols = new Set();
        
        for (const signal of signals) {
            // Проверяем корреляцию с уже выбранными
            let isCorrelated = false;
            for (const selectedSymbol of selectedSymbols) {
                const corr = correlations[`${signal.symbol}-${selectedSymbol}`] || 0;
                if (Math.abs(corr) > maxCorrelation) {
                    isCorrelated = true;
                    break;
                }
            }
            
            if (!isCorrelated) {
                selected.push(signal);
                selectedSymbols.add(signal.symbol);
            }
        }
        
        return selected;
    }
}

module.exports = { CorrelationAnalyzer };
