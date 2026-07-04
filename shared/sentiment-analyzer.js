// ============================================
//  АНАЛИЗ НАСТРОЕНИЙ РЫНКА
// ============================================

const axios = require('axios');

class SentimentAnalyzer {
    constructor() {
        this.sentiment = {
            fearAndGreed: 50,
            btcDominance: 0,
            totalMarketCap: 0,
            volume24h: 0
        };
        this.updateInterval = 60000; // 1 минута
    }

    /**
     * Получить индекс страха и жадности (Fear & Greed Index)
     */
    async getFearAndGreedIndex() {
        try {
            // Альтернативный источник (бесплатный)
            const response = await axios.get('https://api.alternative.me/fng/', {
                timeout: 5000
            });
            
            if (response.data && response.data.data && response.data.data[0]) {
                const value = parseInt(response.data.data[0].value);
                this.sentiment.fearAndGreed = value;
                return value;
            }
        } catch (error) {
            console.error('Ошибка получения Fear & Greed:', error.message);
            return this.sentiment.fearAndGreed;
        }
    }

    /**
     * Получить доминацию BTC
     */
    async getBtcDominance() {
        try {
            const response = await axios.get('https://api.coingecko.com/api/v3/global', {
                timeout: 5000
            });
            
            if (response.data && response.data.data) {
                const dominance = parseFloat(response.data.data.market_cap_percentage.btc);
                this.sentiment.btcDominance = dominance;
                return dominance;
            }
        } catch (error) {
            console.error('Ошибка получения доминации:', error.message);
            return this.sentiment.btcDominance;
        }
    }

    /**
     * Получить рыночную капитализацию
     */
    async getMarketCap() {
        try {
            const response = await axios.get('https://api.coingecko.com/api/v3/global', {
                timeout: 5000
            });
            
            if (response.data && response.data.data) {
                const cap = parseFloat(response.data.data.total_market_cap.usd);
                this.sentiment.totalMarketCap = cap;
                return cap;
            }
        } catch (error) {
            console.error('Ошибка получения капитализации:', error.message);
            return this.sentiment.totalMarketCap;
        }
    }

    /**
     * Получить общий объем торгов
     */
    async getTotalVolume() {
        try {
            const response = await axios.get('https://api.coingecko.com/api/v3/global', {
                timeout: 5000
            });
            
            if (response.data && response.data.data) {
                const volume = parseFloat(response.data.data.total_volume.usd);
                this.sentiment.volume24h = volume;
                return volume;
            }
        } catch (error) {
            console.error('Ошибка получения объема:', error.message);
            return this.sentiment.volume24h;
        }
    }

    /**
     * Получить все данные настроений
     */
    async refreshAll() {
        await Promise.all([
            this.getFearAndGreedIndex(),
            this.getBtcDominance(),
            this.getMarketCap(),
            this.getTotalVolume()
        ]);
        return this.sentiment;
    }

    /**
     * Получить оценку настроения для сигнала
     */
    getSentimentScore(symbol) {
        let score = 0;
        
        // Fear & Greed
        if (this.sentiment.fearAndGreed < 30) {
            score += 0.2; // Страх — хорошее время для покупки
        } else if (this.sentiment.fearAndGreed > 70) {
            score -= 0.2; // Жадность — плохое время для покупки
        }
        
        // BTC Dominance
        if (this.sentiment.btcDominance > 50) {
            score += 0.1; // Доминация BTC растет — альты слабее
        } else {
            score -= 0.1; // Доминация BTC падает — альты сильнее
        }
        
        return Math.max(-1, Math.min(1, score));
    }

    /**
     * Получить рекомендацию на основе настроений
     */
    getRecommendation() {
        const fng = this.sentiment.fearAndGreed;
        
        if (fng < 20) return 'EXTREME_FEAR';
        if (fng < 40) return 'FEAR';
        if (fng < 60) return 'NEUTRAL';
        if (fng < 80) return 'GREED';
        return 'EXTREME_GREED';
    }
}

module.exports = { SentimentAnalyzer };
