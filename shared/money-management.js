// ============================================
//  УПРАВЛЕНИЕ КАПИТАЛОМ (МАРТИНГЕЙЛ)
// ============================================

class MoneyManagement {
    constructor(config = {}) {
        this.baseSize = config.baseSize || 100; // Базовый размер в USDT
        this.maxMultiplier = config.maxMultiplier || 8; // Максимальный множитель
        this.winStreak = 0;
        this.lossStreak = 0;
        this.totalTrades = 0;
        this.consecutiveWins = 0;
        this.consecutiveLosses = 0;
    }

    /**
     * Рассчитать размер следующей позиции (Анти-мартингейл)
     * Увеличиваем размер при выигрыше, уменьшаем при проигрыше
     */
    calculateAntiMartingale(lastTradeResult) {
        if (lastTradeResult === undefined) {
            return this.baseSize;
        }

        if (lastTradeResult > 0) {
            // Выигрыш — увеличиваем размер
            this.winStreak++;
            this.lossStreak = 0;
            const multiplier = Math.min(Math.pow(1.5, this.winStreak), this.maxMultiplier);
            return this.baseSize * multiplier;
        } else {
            // Проигрыш — возвращаем к базовому размеру
            this.lossStreak++;
            this.winStreak = 0;
            return this.baseSize;
        }
    }

    /**
     * Рассчитать размер следующей позиции (Мартингейл)
     * Увеличиваем размер при проигрыше
     */
    calculateMartingale(lastTradeResult) {
        if (lastTradeResult === undefined) {
            return this.baseSize;
        }

        if (lastTradeResult < 0) {
            // Проигрыш — увеличиваем размер
            this.lossStreak++;
            this.winStreak = 0;
            const multiplier = Math.min(Math.pow(2, this.lossStreak), this.maxMultiplier);
            return this.baseSize * multiplier;
        } else {
            // Выигрыш — возвращаем к базовому размеру
            this.winStreak++;
            this.lossStreak = 0;
            return this.baseSize;
        }
    }

    /**
     * Рассчитать размер на основе текущего баланса
     */
    calculateByBalance(balance, riskPercent = 1) {
        return balance * (riskPercent / 100);
    }

    /**
     * Рассчитать размер на основе просадки
     */
    calculateByDrawdown(balance, peakBalance, baseSize) {
        const drawdown = ((peakBalance - balance) / peakBalance) * 100;
        let multiplier = 1;
        
        if (drawdown > 20) multiplier = 0.25;
        else if (drawdown > 10) multiplier = 0.5;
        else if (drawdown > 5) multiplier = 0.75;
        
        return baseSize * multiplier;
    }

    getStats() {
        return {
            winStreak: this.winStreak,
            lossStreak: this.lossStreak,
            totalTrades: this.totalTrades,
            baseSize: this.baseSize,
            currentSize: this.baseSize
        };
    }
}

module.exports = { MoneyManagement };
