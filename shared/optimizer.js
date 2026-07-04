// ============================================
//  АВТОМАТИЧЕСКАЯ ОПТИМИЗАЦИЯ ПАРАМЕТРОВ
// ============================================

class ParameterOptimizer {
    constructor() {
        this.parameters = {
            rsiThreshold: [25, 30, 35],
            macdThreshold: [0, 0.5, 1],
            volumeMultiplier: [1.5, 2, 2.5],
            confidenceThreshold: [0.3, 0.4, 0.5]
        };
        
        this.bestParams = {};
        this.performanceHistory = [];
        this.currentIteration = 0;
        this.maxIterations = 100;
    }

    /**
     * Сгенерировать следующую комбинацию параметров
     */
    nextParams() {
        const params = {};
        for (const [key, values] of Object.entries(this.parameters)) {
            const index = this.currentIteration % values.length;
            params[key] = values[index];
        }
        this.currentIteration++;
        return params;
    }

    /**
     * Оценить производительность параметров
     */
    evaluateParams(params, backtestResults) {
        const score = backtestResults.winRate * 0.4 + 
                      backtestResults.profitFactor * 0.3 + 
                      backtestResults.sharpeRatio * 0.3;
        
        this.performanceHistory.push({
            params,
            score,
            results: backtestResults
        });
        
        // Сохраняем лучшие параметры
        if (!this.bestParams.score || score > this.bestParams.score) {
            this.bestParams = { params, score };
        }
        
        return { score, isBest: score === this.bestParams.score };
    }

    /**
     * Получить лучшие параметры
     */
    getBestParams() {
        return this.bestParams.params || {};
    }

    getStats() {
        return {
            iterations: this.performanceHistory.length,
            bestScore: this.bestParams.score || 0,
            improvements: this.performanceHistory.filter(p => 
                p.score > (this.bestParams.score || 0)
            ).length
        };
    }
}

module.exports = { ParameterOptimizer };
