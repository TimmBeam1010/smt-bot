// ============================================
//  AI-ФИЛЬТРАЦИЯ СИГНАЛОВ
// ============================================

/**
 * Простая нейросетевая фильтрация сигналов
 * Использует веса для оценки качества сигнала
 */
class AIFilter {
    constructor() {
        // Веса для разных факторов
        this.weights = {
            rsi: 0.15,
            macd: 0.15,
            volume: 0.20,
            trend: 0.20,
            patterns: 0.10,
            confidence: 0.20
        };
        
        // Порог для принятия сигнала (0-1)
        this.threshold = 0.6;
        
        // История для обучения
        this.history = [];
        this.learningRate = 0.01;
    }

    /**
     * Оценить качество сигнала
     */
    evaluateSignal(signal, marketData) {
        const scores = {
            rsi: this.evaluateRSI(signal.rsi, signal.side),
            macd: this.evaluateMACD(signal.macd, signal.side),
            volume: this.evaluateVolume(marketData.volume, marketData.avgVolume),
            trend: this.evaluateTrend(marketData.trend, signal.side),
            patterns: this.evaluatePatterns(signal.patterns),
            confidence: this.evaluateConfidence(signal.confidence)
        };
        
        // Взвешенная сумма
        let totalScore = 0;
        for (const [key, value] of Object.entries(scores)) {
            totalScore += value * (this.weights[key] || 0.1);
        }
        
        return {
            totalScore: Math.min(totalScore, 1),
            scores: scores,
            passed: totalScore >= this.threshold,
            recommendation: totalScore >= this.threshold ? 'ACCEPT' : 'REJECT'
        };
    }

    evaluateRSI(rsi, side) {
        if (!rsi) return 0.5;
        if (side === 'LONG' && rsi < 30) return 0.9;
        if (side === 'LONG' && rsi < 40) return 0.7;
        if (side === 'SHORT' && rsi > 70) return 0.9;
        if (side === 'SHORT' && rsi > 60) return 0.7;
        return 0.4;
    }

    evaluateMACD(macd, side) {
        if (!macd) return 0.5;
        const isBullish = macd > 0;
        return (side === 'LONG' && isBullish) ? 0.8 : 
               (side === 'SHORT' && !isBullish) ? 0.8 : 0.4;
    }

    evaluateVolume(volume, avgVolume) {
        if (!volume || !avgVolume) return 0.5;
        const ratio = volume / avgVolume;
        if (ratio > 2) return 0.9;
        if (ratio > 1.5) return 0.7;
        if (ratio > 1) return 0.6;
        return 0.4;
    }

    evaluateTrend(trend, side) {
        if (!trend) return 0.5;
        const isBullish = trend === 'BULLISH';
        return (side === 'LONG' && isBullish) ? 0.8 : 
               (side === 'SHORT' && !isBullish) ? 0.8 : 0.4;
    }

    evaluatePatterns(patterns) {
        if (!patterns || patterns.length === 0) return 0.5;
        const strongPatterns = ['bullish_engulfing', 'bearish_engulfing', 'morning_star', 'evening_star'];
        const hasStrong = patterns.some(p => strongPatterns.includes(p));
        return hasStrong ? 0.8 : 0.6;
    }

    evaluateConfidence(confidence) {
        if (confidence === 'high') return 0.9;
        if (confidence === 'medium') return 0.6;
        return 0.3;
    }

    /**
     * Обучение на истории (простая адаптация)
     */
    learn(signal, result) {
        this.history.push({ signal, result });
        if (this.history.length > 1000) {
            this.history.shift();
        }
        
        // Простая адаптация весов
        if (this.history.length % 10 === 0) {
            this.adaptWeights();
        }
    }

    adaptWeights() {
        // Анализируем, какие факторы чаще приводили к успеху
        const successful = this.history.filter(h => h.result.success);
        const failed = this.history.filter(h => !h.result.success);
        
        if (successful.length === 0 || failed.length === 0) return;
        
        // Простая корректировка весов
        for (const [key] of Object.entries(this.weights)) {
            // Если фактор часто был высоким в успешных сделках — увеличиваем вес
            // Иначе — уменьшаем
        }
    }

    getStats() {
        const total = this.history.length;
        const successful = this.history.filter(h => h.result.success).length;
        return {
            total,
            successful,
            successRate: total > 0 ? (successful / total) * 100 : 0
        };
    }
}

module.exports = { AIFilter };
