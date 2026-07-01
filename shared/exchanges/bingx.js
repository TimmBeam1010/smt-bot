// ============================================
//  МОДУЛЬ BINGX (ФЬЮЧЕРСЫ) С ПОВТОРНЫМИ ПОПЫТКАМИ
// ============================================

const crypto = require('crypto');
const axios = require('axios');

class BingXExchange {
    constructor(apiKey, secretKey) {
        this.apiKey = apiKey;
        this.secretKey = secretKey;
        this.name = 'bingx';
        this.maxRetries = 3;
        this.retryDelay = 1000;
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async getBalance() {
        let lastError = null;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const timestamp = Date.now().toString();
                const payload = `timestamp=${timestamp}`;
                const signature = crypto.createHmac('sha256', this.secretKey)
                    .update(payload)
                    .digest('hex');

                const url = `https://open-api.bingx.com/openApi/swap/v3/user/balance?${payload}&signature=${signature}`;

                const response = await axios.get(url, {
                    headers: { 'X-BX-APIKEY': this.apiKey },
                    timeout: 10000
                });

                if (response.data?.code === 0 && response.data?.data) {
                    const usdtData = response.data.data.find(item => item.asset === 'USDT');
                    if (usdtData) {
                        return parseFloat(usdtData.equity) || parseFloat(usdtData.balance) || 0;
                    }
                    return 0;
                }

                // Если код не 0, пробуем ещё раз
                if (response.data?.code === 100410) {
                    console.log(`⚠️ BingX: Частотный лимит (${response.data.msg}), попытка ${attempt}/${this.maxRetries}`);
                    await this.sleep(this.retryDelay * attempt);
                    continue;
                }

                console.error('❌ BingX: Ошибка баланса', response.data);
                return null;

            } catch (error) {
                lastError = error;
                console.error(`❌ BingX: Ошибка getBalance (попытка ${attempt}/${this.maxRetries}):`, error.message);
                if (attempt < this.maxRetries) {
                    await this.sleep(this.retryDelay * attempt);
                }
            }
        }

        console.error('❌ BingX: Превышено количество попыток getBalance');
        return null;
    }

    // ... остальные методы (placeOrder, testCredentials) остаются без изменений
    async placeOrder(symbol, side, quantity, price = null) {
        try {
            const timestamp = Date.now().toString();
            const formattedSymbol = symbol.replace('-', '_');
    
            // Параметры должны быть отсортированы по алфавиту
            const params = {
                quantity: quantity.toString(),
                side: side,
                symbol: formattedSymbol,
                type: 'MARKET'
            };
    
            // Сортируем параметры для подписи
            const sortedKeys = Object.keys(params).sort();
            let queryString = '';
            for (const key of sortedKeys) {
                if (queryString) queryString += '&';
                queryString += `${key}=${params[key]}`;
            }
    
            // ПОДПИСЬ: timestamp + queryString (без &)
            const payload = timestamp + queryString;
            const signature = crypto.createHmac('sha256', this.secretKey)
                .update(payload)
                .digest('hex');
    
            console.log('📝 Подпись для ордера (v2, исправлено):', {
                timestamp,
                queryString,
                signature,
                payload
            });
    
            const url = 'https://open-api.bingx.com/openApi/swap/v2/trade/order';
    
            const response = await axios.post(url, params, {
                headers: {
                    'X-BX-APIKEY': this.apiKey,
                    'X-BX-SIGNATURE': signature,
                    'X-BX-TIMESTAMP': timestamp,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });
    
            if (response.data?.code === 0) {
                return {
                    orderId: response.data.data.orderId,
                    symbol: symbol,
                    side: side,
                    quantity: quantity,
                    price: price,
                    status: 'filled'
                };
            }
            console.error('❌ BingX: Ошибка ордера (v2)', response.data);
            return null;
        } catch (error) {
            console.error('❌ BingX: Ошибка placeOrder', error.response?.data || error.message);
            return null;
        }
    }

    async testCredentials() {
        const balance = await this.getBalance();
        return balance !== null && balance !== undefined;
    }
}

module.exports = BingXExchange;