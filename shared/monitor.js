// ============================================
//  МОНИТОРИНГ ПРОИЗВОДИТЕЛЬНОСТИ
// ============================================

class PerformanceMonitor {
    constructor() {
        this.metrics = {
            signalsGenerated: 0,
            tradesExecuted: 0,
            tradesWon: 0,
            tradesLost: 0,
            totalProfit: 0,
            startTime: Date.now()
        };
        this.history = [];
        this.maxHistorySize = 1000;
    }

    trackSignal(symbol, side, confidence) {
        this.metrics.signalsGenerated++;
        this.log(`📊 Сигнал: ${symbol} ${side} (${confidence})`);
    }

    trackTrade(signal, result) {
        this.metrics.tradesExecuted++;
        if (result.profit > 0) {
            this.metrics.tradesWon++;
        } else {
            this.metrics.tradesLost++;
        }
        this.metrics.totalProfit += result.profit || 0;
        
        this.history.push({
            timestamp: new Date().toISOString(),
            symbol: signal.symbol,
            side: signal.side,
            entry: signal.entry_price,
            exit: result.exitPrice || signal.entry_price,
            profit: result.profit || 0,
            confidence: signal.confidence
        });
        
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        }
    }

    getStats() {
        const total = this.metrics.tradesExecuted;
        const wins = this.metrics.tradesWon;
        const losses = this.metrics.tradesLost;
        const winRate = total > 0 ? (wins / total) * 100 : 0;
        const avgProfit = total > 0 ? this.metrics.totalProfit / total : 0;
        const runningTime = Math.floor((Date.now() - this.metrics.startTime) / 60000); // минут
        
        return {
            ...this.metrics,
            totalTrades: total,
            winRate: winRate,
            avgProfit: avgProfit,
            runningMinutes: runningTime,
            winLossRatio: losses > 0 ? wins / losses : '∞'
        };
    }

    log(message) {
        console.log(`[${new Date().toISOString()}] [MONITOR] ${message}`);
    }

    printReport() {
        const stats = this.getStats();
        const report = `
📊 === ОТЧЕТ О ПРОИЗВОДИТЕЛЬНОСТИ ===
⏱️  Время работы: ${stats.runningMinutes} минут
📈 Сигналов: ${stats.signalsGenerated}
💰 Сделок: ${stats.totalTrades}
✅ Выигрышей: ${stats.tradesWon} (${stats.winRate.toFixed(1)}%)
❌ Проигрышей: ${stats.tradesLost}
📊 Win/Loss: ${stats.winLossRatio}
💵 Общая прибыль: $${stats.totalProfit.toFixed(2)}
📊 Средняя прибыль: $${stats.avgProfit.toFixed(2)}
        `;
        console.log(report);
        return report;
    }
}

module.exports = { PerformanceMonitor };
