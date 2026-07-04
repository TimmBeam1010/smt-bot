// ============================================
//  УМНОЕ УПРАВЛЕНИЕ КАПИТАЛОМ
// ============================================

class CapitalManager {
    constructor(initialBalance) {
        this.balance = initialBalance;
        this.peakBalance = initialBalance;
        this.maxDrawdown = 0;
        this.totalTrades = 0;
        this.winningTrades = 0;
        this.losingTrades = 0;
        this.profitHistory = [];
    }

    /**
     * Рассчитать размер следующей позиции
     */
    calculatePositionSize(signal, currentBalance, riskPercent = 1) {
        const baseSize = currentBalance * (riskPercent / 100);
        
        // Корректировка на основе просадки
        const drawdown = this.getDrawdown();
        let drawdownMultiplier = 1;
        if (drawdown > 10) drawdownMultiplier = 0.5;
        else if (drawdown > 20) drawdownMultiplier = 0.25;
        else if (drawdown > 30) drawdownMultiplier = 0.1;
        
        // Корректировка на основе винрейта
        const winRate = this.getWinRate();
        let winRateMultiplier = 1;
        if (winRate < 30) winRateMultiplier = 0.5;
        else if (winRate > 70) winRateMultiplier = 1.5;
        
        // Корректировка на основе confidence
        const confidenceMultiplier = signal.confidence === 'high' ? 1.5 : 
                                     signal.confidence === 'medium' ? 1 : 0.5;
        
        let finalSize = baseSize * drawdownMultiplier * winRateMultiplier * confidenceMultiplier;
        
        // Ограничиваем минимальный и максимальный размер
        const minSize = currentBalance * 0.01;
        const maxSize = currentBalance * 0.05;
        finalSize = Math.max(minSize, Math.min(finalSize, maxSize));
        
        return finalSize;
    }

    /**
     * Обновить статистику после сделки
     */
    updateStats(profit, balance) {
        this.totalTrades++;
        if (profit > 0) {
            this.winningTrades++;
        } else {
            this.losingTrades++;
        }
        
        this.balance = balance;
        this.profitHistory.push(profit);
        if (this.profitHistory.length > 100) {
            this.profitHistory.shift();
        }
        
        if (balance > this.peakBalance) {
            this.peakBalance = balance;
        }
        
        const drawdown = ((this.peakBalance - balance) / this.peakBalance) * 100;
        if (drawdown > this.maxDrawdown) {
            this.maxDrawdown = drawdown;
        }
    }

    getDrawdown() {
        if (this.peakBalance === 0) return 0;
        return ((this.peakBalance - this.balance) / this.peakBalance) * 100;
    }

    getWinRate() {
        if (this.totalTrades === 0) return 0;
        return (this.winningTrades / this.totalTrades) * 100;
    }

    getStats() {
        return {
            balance: this.balance,
            peakBalance: this.peakBalance,
            drawdown: this.getDrawdown(),
            maxDrawdown: this.maxDrawdown,
            totalTrades: this.totalTrades,
            winRate: this.getWinRate(),
            winningTrades: this.winningTrades,
            losingTrades: this.losingTrades,
            avgProfit: this.profitHistory.length > 0 ? 
                this.profitHistory.reduce((a, b) => a + b, 0) / this.profitHistory.length : 0
        };
    }
}

module.exports = { CapitalManager };
