// ============================================
//  ВОССТАНОВЛЕНИЕ ПОСЛЕ ПРОСАДКИ
// ============================================

class RecoveryManager {
    constructor(config = {}) {
        this.maxDrawdown = config.maxDrawdown || 20; // Максимальная просадка в %
        this.recoveryMultiplier = config.recoveryMultiplier || 1.5; // Множитель для восстановления
        this.tradeHistory = [];
        this.isRecoveryMode = false;
        this.recoveryTrades = 0;
        this.maxRecoveryTrades = config.maxRecoveryTrades || 5;
    }

    /**
     * Проверить, нужно ли восстанавливаться
     */
    checkRecovery(currentBalance, peakBalance) {
        const drawdown = ((peakBalance - currentBalance) / peakBalance) * 100;
        
        if (drawdown > this.maxDrawdown) {
            this.isRecoveryMode = true;
            console.log(`⚠️ АКТИВИРОВАН РЕЖИМ ВОССТАНОВЛЕНИЯ! Просадка: ${drawdown.toFixed(2)}%`);
            return true;
        }
        
        this.isRecoveryMode = false;
        return false;
    }

    /**
     * Рассчитать размер для восстановительной сделки
     */
    calculateRecoverySize(originalSize, currentBalance, peakBalance) {
        if (!this.isRecoveryMode) return originalSize;
        
        const drawdown = ((peakBalance - currentBalance) / peakBalance) * 100;
        const recoveryFactor = 1 + (drawdown / 100) * this.recoveryMultiplier;
        const size = originalSize * recoveryFactor;
        
        console.log(`📊 Восстановительный размер: ${size} (фактор: ${recoveryFactor.toFixed(2)})`);
        return size;
    }

    /**
     * Обновить историю сделок
     */
    updateHistory(trade) {
        this.tradeHistory.push(trade);
        if (this.tradeHistory.length > 100) {
            this.tradeHistory.shift();
        }
    }

    /**
     * Проверить, успешно ли восстановление
     */
    checkRecoverySuccess(currentBalance, peakBalance) {
        if (!this.isRecoveryMode) return false;
        
        const drawdown = ((peakBalance - currentBalance) / peakBalance) * 100;
        if (drawdown < this.maxDrawdown * 0.5) {
            this.isRecoveryMode = false;
            console.log(`✅ ВОССТАНОВЛЕНИЕ УСПЕШНО! Просадка: ${drawdown.toFixed(2)}%`);
            return true;
        }
        return false;
    }

    /**
     * Получить статистику восстановления
     */
    getStats() {
        return {
            isRecoveryMode: this.isRecoveryMode,
            recoveryTrades: this.recoveryTrades,
            maxRecoveryTrades: this.maxRecoveryTrades,
            totalTrades: this.tradeHistory.length
        };
    }
}

module.exports = { RecoveryManager };
