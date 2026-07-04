// ============================================
//  УМНЫЙ СТОП-ЛОСС (НА ОСНОВЕ ВОЛАТИЛЬНОСТИ)
// ============================================

class SmartStopLoss {
    constructor(config = {}) {
        this.baseMultiplier = config.baseMultiplier || 1.5;
        this.maxMultiplier = config.maxMultiplier || 3.0;
        this.minMultiplier = config.minMultiplier || 1.0;
        this.atrPeriod = config.atrPeriod || 14;
    }

    /**
     * Рассчитать стоп-лосс на основе ATR
     */
    calculateATRStopLoss(entryPrice, side, atr, volatility) {
        // Базовая волатильность
        const volFactor = 1 + volatility;
        
        // Адаптивный множитель
        let multiplier = this.baseMultiplier * volFactor;
        multiplier = Math.max(this.minMultiplier, Math.min(multiplier, this.maxMultiplier));
        
        const slDistance = atr * multiplier;
        
        if (side === 'LONG') {
            return entryPrice - slDistance;
        } else {
            return entryPrice + slDistance;
        }
    }

    /**
     * Рассчитать стоп-лосс на основе поддержки/сопротивления
     */
    calculateLevelStopLoss(entryPrice, side, support, resistance) {
        if (side === 'LONG' && support) {
            return support * 0.995;
        }
        if (side === 'SHORT' && resistance) {
            return resistance * 1.005;
        }
        return null;
    }

    /**
     * Рассчитать стоп-лосс на основе скользящих средних
     */
    calculateMAStopLoss(entryPrice, side, sma20, sma50) {
        if (side === 'LONG') {
            return Math.min(sma20, sma50) * 0.99;
        } else {
            return Math.max(sma20, sma50) * 1.01;
        }
    }

    /**
     * Комбинированный расчет стоп-лосса
     */
    calculateCombinedStopLoss(entryPrice, side, atr, volatility, support, resistance, sma20, sma50) {
        const sls = [];
        
        // ATR-based
        const atrSl = this.calculateATRStopLoss(entryPrice, side, atr, volatility);
        if (atrSl) sls.push(atrSl);
        
        // Level-based
        const levelSl = this.calculateLevelStopLoss(entryPrice, side, support, resistance);
        if (levelSl) sls.push(levelSl);
        
        // MA-based
        const maSl = this.calculateMAStopLoss(entryPrice, side, sma20, sma50);
        if (maSl) sls.push(maSl);
        
        if (sls.length === 0) {
            // Дефолтный SL
            return side === 'LONG' ? entryPrice * 0.985 : entryPrice * 1.015;
        }
        
        // Выбираем самый безопасный SL (самый близкий к цене)
        if (side === 'LONG') {
            return Math.max(...sls);
        } else {
            return Math.min(...sls);
        }
    }

    /**
     * Получить рекомендацию по SL
     */
    getRecommendation(entryPrice, side, volatility) {
        const baseSl = side === 'LONG' ? entryPrice * 0.985 : entryPrice * 1.015;
        const tightSl = side === 'LONG' ? entryPrice * 0.99 : entryPrice * 1.01;
        const wideSl = side === 'LONG' ? entryPrice * 0.975 : entryPrice * 1.025;
        
        if (volatility > 0.05) {
            return { recommended: wideSl, type: 'WIDE', reason: 'Высокая волатильность' };
        } else if (volatility < 0.02) {
            return { recommended: tightSl, type: 'TIGHT', reason: 'Низкая волатильность' };
        } else {
            return { recommended: baseSl, type: 'NORMAL', reason: 'Средняя волатильность' };
        }
    }
}

module.exports = { SmartStopLoss };
