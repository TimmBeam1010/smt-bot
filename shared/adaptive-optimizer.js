// ============================================
//  АДАПТИВНАЯ ОПТИМИЗАЦИЯ ПАРАМЕТРОВ
// ============================================

class AdaptiveOptimizer {
    constructor() {
        this.params = {
            rsiThreshold: 30,
            macdThreshold: 0,
            volumeMultiplier: 2,
            confidenceThreshold: 0.4
        };
        this.performance = [];
        this.bestParams = { ...this.params };
        this.bestScore = -Infinity;
        this.adaptationRate = 0.1;
    }

    /**
     * Адаптировать параметры под рынок
     */
    adapt(backtestResults, marketCondition) {
        const currentScore = this.calculateScore(backtestResults);
        
        // Сохраняем производительность
        this.performance.push({
            params: { ...this.params },
            score: currentScore,
            marketCondition: marketCondition,
            timestamp: new Date().toISOString()
        });
        
        if (this.performance.length > 100) {
            this.performance.shift();
        }
        
        // Если текущие параметры лучше — сохраняем
        if (currentScore > this.bestScore) {
            this.bestScore = currentScore;
            this.bestParams = { ...this.params };
            console.log(`📊 Найдены лучшие параметры: ${JSON.stringify(this.bestParams)}`);
        }
        
        // Адаптация под текущий рынок
        this.adaptToMarket(marketCondition);
        
        return this.params;
    }

    /**
     * Адаптация под текущий рынок
     */
    adaptToMarket(marketCondition) {
        if (marketCondition === 'HIGH_VOLATILITY') {
            this.params.rsiThreshold = 35;
            this.params.volumeMultiplier = 2.5;
            this.params.confidenceThreshold = 0.5;
        } else if (marketCondition === 'LOW_VOLATILITY') {
            this.params.rsiThreshold = 25;
            this.params.volumeMultiplier = 1.5;
            this.params.confidenceThreshold = 0.3;
        } else if (marketCondition === 'TRENDING') {
            this.params.rsiThreshold = 30;
            this.params.macdThreshold = 0.5;
            this.params.confidenceThreshold = 0.4;
        } else if (marketCondition === 'RANGING') {
            this.params.rsiThreshold = 35;
            this.params.macdThreshold = 0;
            this.params.confidenceThreshold = 0.5;
        }
    }

    /**
     * Рассчитать оценку производительности
     */
    calculateScore(results) {
        const winRate = results.winRate || 0;
        const profitFactor = results.profitFactor || 0;
        const sharpe = results.sharpeRatio || 0;
        const maxDrawdown = results.maxDrawdown || 100;
        
        // Чем выше — тем лучше
        let score = winRate * 0.4 + profitFactor * 0.3 + sharpe * 0.2 - (maxDrawdown / 100) * 0.1;
        return Math.max(0, score);
    }

    /**
     * Получить текущие параметры
     */
    getParams() {
        return { ...this.params };
    }

    /**
     * Получить лучшие параметры
     */
    getBestParams() {
        return { ...this.bestParams };
    }

    /**
     * Получить статистику оптимизации
     */
    getStats() {
        return {
            currentParams: this.params,
            bestParams: this.bestParams,
            bestScore: this.bestScore,
            performanceSize: this.performance.length,
            adaptationRate: this.adaptationRate
        };
    }
}

module.exports = { AdaptiveOptimizer };
