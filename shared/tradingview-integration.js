// ============================================
//  ИНТЕГРАЦИЯ С TRADINGVIEW (WEBHOOKS)
// ============================================

const http = require('http');
const url = require('url');

class TradingViewIntegration {
    constructor(config = {}) {
        this.port = config.port || 8080;
        this.secretKey = config.secretKey || 'YOUR_SECRET_KEY';
        this.onSignal = null;
        this.server = null;
        this.signals = [];
    }

    /**
     * Запустить Webhook сервер
     */
    start() {
        this.server = http.createServer((req, res) => {
            if (req.method === 'POST' && req.url === '/webhook') {
                this.handleWebhook(req, res);
            } else {
                res.writeHead(404);
                res.end('Not Found');
            }
        });

        this.server.listen(this.port, () => {
            console.log(`📡 TradingView Webhook сервер запущен на порту ${this.port}`);
        });
    }

    /**
     * Обработать Webhook запрос
     */
    handleWebhook(req, res) {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                
                // Проверка секретного ключа
                if (data.secret && data.secret !== this.secretKey) {
                    res.writeHead(403);
                    res.end('Forbidden');
                    return;
                }

                console.log(`📊 Получен сигнал от TradingView:`, data);
                
                // Сохраняем сигнал
                this.signals.push({
                    ...data,
                    receivedAt: new Date().toISOString()
                });

                // Если есть обработчик — вызываем
                if (this.onSignal) {
                    this.onSignal(data);
                }

                res.writeHead(200);
                res.end('OK');
            } catch (error) {
                console.error('❌ Ошибка обработки Webhook:', error.message);
                res.writeHead(500);
                res.end('Error');
            }
        });
    }

    /**
     * Установить обработчик сигналов
     */
    setSignalHandler(handler) {
        this.onSignal = handler;
        console.log('📊 Обработчик сигналов установлен');
    }

    /**
     * Получить последние сигналы
     */
    getSignals(limit = 10) {
        return this.signals.slice(-limit);
    }

    /**
     * Остановить сервер
     */
    stop() {
        if (this.server) {
            this.server.close();
            console.log('📡 TradingView Webhook сервер остановлен');
        }
    }
}

module.exports = { TradingViewIntegration };
