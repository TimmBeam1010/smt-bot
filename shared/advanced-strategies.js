// ============================================
//  ИНТЕГРАЦИЯ ВСЕХ СТРАТЕГИЙ
// ============================================

const { MoneyManagement } = require('./money-management');
const { SentimentAnalyzer } = require('./sentiment-analyzer');
const { GridStrategy } = require('./grid-strategy');
const { DCAStrategy } = require('./dca-strategy');

class AdvancedStrategies {
    constructor(config = {}) {
        this.moneyManager = new MoneyManagement(config.money);
        this.sentiment = new SentimentAnalyzer();
        this.grid = null;
        this.dca = null;
        this.config = config;
        this.isActive = false;
    }

    /**
     * Активировать все стратегии
     */
    async activate(symbol) {
        this.isActive = true;
        this.symbol = symbol;
        
        // Обновляем настроения
        await this.sentiment.refreshAll();
        
        console.log(`🚀 Продвинутые стратегии активированы для ${symbol}`);
        console.log(`📊 Fear & Greed: ${this.sentiment.sentiment.fearAndGreed}`);
        console.log(`📊 BTC Dominance: ${this.sentiment.sentiment.btcDominance.toFixed(2)}%`);
        
        return this;
    }

    /**
     * Получить комбинированный сигнал
     */
    async getCombinedSignal(symbol, price, technicalSignal) {
        if (!this.isActive) return technicalSignal;
        
        // Получаем настроения
        await this.sentiment.refreshAll();
        const sentimentScore = this.sentiment.getSentimentScore(symbol);
        
        // Корректируем сигнал на основе настроений
        let adjustedSignal = { ...technicalSignal };
        
        if (sentimentScore > 0.3 && technicalSignal.side === 'LONG') {
            adjustedSignal.confidence = 'high';
            adjustedSignal.reasons.push('Подтверждено настроениями рынка');
        } else if (sentimentScore < -0.3 && technicalSignal.side === 'SHORT') {
            adjustedSignal.confidence = 'high';
            adjustedSignal.reasons.push('Подтверждено настроениями рынка');
        } else if (Math.abs(sentimentScore) < 0.1) {
            adjustedSignal.reasons.push('Нейтральные настроения рынка');
        }
        
        // Корректируем размер позиции
        const moneySize = this.moneyManager.calculateByBalance(
            this.config.balance || 10000,
            this.config.riskPercent || 1
        );
        
        adjustedSignal.positionSize = moneySize;
        
        return adjustedSignal;
    }

    /**
     * Запустить DCA для символа
     */
    startDCA(symbol, side, price, totalAmount = 1000, parts = 5) {
        this.dca = new DCAStrategy({ totalAmount, parts });
        this.dca.start(symbol, side, price);
        return this.dca;
    }

    /**
     * Создать сетку ордеров
     */
    createGrid(price, side, levels = 10, gridSize = 1) {
        this.grid = new GridStrategy({ levels, gridSize });
        const grid = this.grid.createGrid(price, side);
        return grid;
    }

    /**
     * Получить отчет
     */
    getReport() {
        return {
            sentiment: this.sentiment.sentiment,
            moneyManagement: this.moneyManager.getStats(),
            dca: this.dca ? this.dca.getStatus(0) : null,
            grid: this.grid ? this.grid.orders.length : 0
        };
    }
}

module.exports = { AdvancedStrategies };
