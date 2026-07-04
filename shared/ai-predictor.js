// ============================================
//  AI-ПРЕДСКАЗАНИЕ ЦЕН (ПРОСТАЯ НЕЙРОСЕТЬ)
// ============================================

class AIPredictor {
    constructor(config = {}) {
        this.history = [];
        this.weights = {
            rsi: 0.2,
            macd: 0.2,
            volume: 0.15,
            trend: 0.25,
            momentum: 0.2
        };
        this.learningRate = config.learningRate || 0.01;
        this.accuracy = 0;
        this.predictions = 0;
        this.correctPredictions = 0;
    }

    /**
     * Предсказать движение цены
     */
    predict(signal, marketData) {
        const features = this.extractFeatures(signal, marketData);
        let score = 0;
        
        for (const [key, value] of Object.entries(features)) {
            score += value * (this.weights[key] || 0.1);
        }
        
        const prediction = {
            direction: score > 0.5 ? 'UP' : 'DOWN',
            confidence: Math.abs(score - 0.5) * 2,
            score: score,
            features: features
        };
        
        this.predictions++;
        return prediction;
    }

    /**
     * Извлечь признаки для предсказания
     */
    extractFeatures(signal, marketData) {
        const features = {
            rsi: this.normalizeRSI(signal.rsi),
            macd: this.normalizeMACD(signal.macd),
            volume: this.normalizeVolume(marketData.volume, marketData.avgVolume),
            trend: this.normalizeTrend(marketData.trend),
            momentum: this.normalizeMomentum(marketData.priceChange)
        };
        
        return features;
    }

    /**
     * Нормализация признаков
     */
    normalizeRSI(rsi) {
        if (!rsi) return 0.5;
        return Math.max(0, Math.min(1, rsi / 100));
    }

    normalizeMACD(macd) {
        if (!macd) return 0.5;
        return Math.max(0, Math.min(1, (macd + 1) / 2));
    }

    normalizeVolume(volume, avgVolume) {
        if (!volume || !avgVolume) return 0.5;
        const ratio = volume / avgVolume;
        return Math.max(0, Math.min(1, ratio / 3));
    }

    normalizeTrend(trend) {
        if (trend === 'BULLISH') return 0.8;
        if (trend === 'BEARISH') return 0.2;
        return 0.5;
    }

    normalizeMomentum(change) {
        if (!change) return 0.5;
        return Math.max(0, Math.min(1, (change + 5) / 10));
    }

    /**
     * Обучение на результате
     */
    learn(signal, prediction, actualResult) {
        const error = actualResult - prediction.score;
        const features = this.extractFeatures(signal, {});
        
        // Обновляем веса
        for (const [key, value] of Object.entries(features)) {
            this.weights[key] += this.learningRate * error * value;
            // Ограничиваем веса
            this.weights[key] = Math.max(0.01, Math.min(0.5, this.weights[key]));
        }
        
        // Обновляем точность
        const isCorrect = (prediction.direction === 'UP' && actualResult > 0) ||
                         (prediction.direction === 'DOWN' && actualResult < 0);
        
        if (isCorrect) {
            this.correctPredictions++;
        }
        
        this.history.push({ signal, prediction, actualResult, isCorrect });
        if (this.history.length > 1000) {
            this.history.shift();
        }
        
        this.accuracy = this.predictions > 0 ? (this.correctPredictions / this.predictions) * 100 : 0;
        return isCorrect;
    }

    /**
     * Получить статистику
     */
    getStats() {
        return {
            accuracy: this.accuracy,
            predictions: this.predictions,
            correctPredictions: this.correctPredictions,
            weights: this.weights,
            historySize: this.history.length
        };
    }
}

module.exports = { AIPredictor };
