// ============================================
//  МОНИТОРИНГ НОВОСТЕЙ
// ============================================

const axios = require('axios');

class NewsMonitor {
    constructor(config = {}) {
        this.news = [];
        this.alertKeywords = config.keywords || ['btc', 'bitcoin', 'ethereum', 'crypto', 'market'];
        this.lastUpdate = 0;
        this.updateInterval = config.updateInterval || 60000; // 1 минута
    }

    /**
     * Получить новости из API
     */
    async fetchNews() {
        try {
            // CryptoPanic API (бесплатный)
            const response = await axios.get('https://cryptopanic.com/api/v1/posts/', {
                params: {
                    auth_token: process.env.CRYPTOPANIC_TOKEN || 'YOUR_TOKEN',
                    public: true,
                    limit: 50
                },
                timeout: 5000
            });
            
            if (response.data && response.data.results) {
                this.news = response.data.results;
                this.lastUpdate = Date.now();
                return this.news;
            }
        } catch (error) {
            console.error('❌ Ошибка получения новостей:', error.message);
            return this.news;
        }
    }

    /**
     * Анализировать новости на предмет важных событий
     */
    analyzeNews(symbol) {
        const relevant = this.news.filter(item => {
            const text = (item.title + ' ' + (item.body || '')).toLowerCase();
            return text.includes(symbol.toLowerCase()) || text.includes('bitcoin') || text.includes('crypto');
        });
        
        let sentiment = 0;
        let impact = 0;
        
        for (const item of relevant) {
            // Простой анализ настроений
            const text = (item.title + ' ' + (item.body || '')).toLowerCase();
            const positive = ['bull', 'up', 'gain', 'rise', 'surge', 'rally', 'positive', 'growth'];
            const negative = ['bear', 'down', 'fall', 'drop', 'crash', 'decline', 'negative', 'loss'];
            
            for (const word of positive) {
                if (text.includes(word)) sentiment += 1;
            }
            for (const word of negative) {
                if (text.includes(word)) sentiment -= 1;
            }
            
            // Важность новости
            if (text.includes('breaking') || text.includes('urgent')) {
                impact += 2;
            }
            if (text.includes('sec') || text.includes('regulation') || text.includes('lawsuit')) {
                impact += 3;
            }
        }
        
        return {
            count: relevant.length,
            sentiment: sentiment,
            impact: impact,
            isPositive: sentiment > 0,
            isNegative: sentiment < 0,
            isImportant: impact > 5
        };
    }

    /**
     * Получить предупреждение о важных новостях
     */
    getAlert(symbol) {
        const analysis = this.analyzeNews(symbol);
        if (analysis.isImportant && analysis.isNegative) {
            return {
                level: 'HIGH',
                message: `⚠️ Важные негативные новости по ${symbol}!`,
                details: analysis
            };
        }
        if (analysis.isImportant && analysis.isPositive) {
            return {
                level: 'MEDIUM',
                message: `📈 Позитивные новости по ${symbol}`,
                details: analysis
            };
        }
        return null;
    }

    /**
     * Получить сводку новостей
     */
    getSummary() {
        const symbols = this.news.reduce((acc, item) => {
            const text = (item.title + ' ' + (item.body || '')).toLowerCase();
            for (const keyword of this.alertKeywords) {
                if (text.includes(keyword)) {
                    if (!acc[keyword]) acc[keyword] = 0;
                    acc[keyword]++;
                }
            }
            return acc;
        }, {});
        
        return {
            totalNews: this.news.length,
            symbols: symbols,
            lastUpdate: new Date(this.lastUpdate).toISOString()
        };
    }
}

module.exports = { NewsMonitor };
