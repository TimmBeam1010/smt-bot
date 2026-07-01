// ============================================
//  МОДУЛЬ BINGX (РУЧНАЯ ПОДПИСЬ - FULL FIX)
// ============================================

const crypto = require('crypto');
const axios = require('axios');

class BingXExchange {
    constructor(apiKey, secretKey) {
        this.apiKey = apiKey;
        this.secretKey = secretKey;
        this.name = 'bingx';
        this.baseURL = 'https://open-api.bingx.com';
    }

    /**
     * Генерация подписи для BingX API
     * @param {Object} params - параметры запроса
     * @param {string} timestamp - временная метка
     * @returns {string} - подпись в hex формате
     */
    _generateSignature(params, timestamp) {
        // Сортируем параметры по алфавиту
        const sortedParams = Object.keys(params)
            .sort()
            .map(key => `${key}=${params[key]}`)
            .join('&');
        
        // Строка для подписи: timestamp + параметры
        const signatureString = `${timestamp}${sortedParams}`;
        
        console.log('🔐 Строка для подписи:', signatureString.substring(0, 100) + '...');
        
        // Генерируем HMAC-SHA256
        return crypto
            .createHmac('sha256', this.secretKey)
            .update(signatureString)
            .digest('hex');
    }

    /**
     * Выполнение подписанного запроса к API
     */
    async _signedRequest(method, endpoint, params = {}) {
        const timestamp = Date.now().toString();
        
        // Объединяем параметры
        const allParams = {
            ...params,
            timestamp: timestamp
        };

        // Генерируем подпись
        const signature = this._generateSignature(allParams, timestamp);
        
        // Формируем URL
        const url = `${this.baseURL}${endpoint}`;
        
        // Параметры для строки запроса (GET) или тела (POST)
        const requestParams = {
            ...allParams,
            signature: signature
        };

        const headers = {
            'X-BX-APIKEY': this.apiKey,
            'Content-Type': 'application/json'
        };

        let config = {
            method: method,
            url: url,
            headers: headers
        };

        if (method === 'GET') {
            // Для GET - параметры в строке запроса
            const queryString = Object.keys(requestParams)
                .map(key => `${key}=${encodeURIComponent(requestParams[key])}`)
                .join('&');
            config.url = `${url}?${queryString}`;
        } else if (method === 'POST') {
            // Для POST - параметры в теле
            config.data = requestParams;
        }

        try {
            console.log(`📡 ${method} запрос к ${endpoint}`);
            const response = await axios(config);
            
            // Логируем ответ для отладки
            if (response.data && response.data.code !== 0) {
                console.error(`⚠️ Ответ с ошибкой:`, response.data);
            }
            
            return response.data;
        } catch (error) {
            console.error(`❌ BingX: Ошибка запроса ${endpoint}`, {
                message: error.message,
                response: error.response?.data,
                status: error.response?.status
            });
            throw error;
        }
    }

    /**
     * Получение баланса фьючерсного счёта
     */
    async getBalance() {
        try {
            const response = await this._signedRequest(
                'GET',
                '/openApi/swap/v3/user/balance'
            );

            if (response && response.code === 0) {
                // Проверяем структуру ответа
                const balanceData = response.data?.balance || response.data || [];
                
                // Ищем USDT
                const usdtData = Array.isArray(balanceData) 
                    ? balanceData.find(item => item.asset === 'USDT')
                    : null;
                
                if (usdtData) {
                    const balance = parseFloat(usdtData.equity) || parseFloat(usdtData.balance) || 0;
                    console.log(`💰 Баланс USDT: $${balance}`);
                    return balance;
                }
                
                console.log('ℹ️ USDT не найден в балансе', balanceData);
                return 0;
            }
            
            console.error('❌ BingX: Ошибка получения баланса', response);
            return null;
        } catch (error) {
            console.error('❌ BingX: Ошибка getBalance', error.message);
            return null;
        }
    }

    /**
     * Создание ордера на фьючерсном рынке
     */
    async placeOrder(symbol, side, quantity, price = null) {
        try {
            // Формат символа для фьючерсов BTC_USDT
            const symbolFormatted = symbol.replace('-', '_');

            // Базовые параметры ордера
            const params = {
                symbol: symbolFormatted,
                side: side, // 'BUY' или 'SELL'
                type: 'MARKET',
                quantity: quantity.toString(),
                positionSide: side === 'BUY' ? 'LONG' : 'SHORT',
                recvWindow: '5000'
            };

            // Если указана цена и тип LIMIT
            if (price && price > 0) {
                params.type = 'LIMIT';
                params.price = price.toString();
            }

            console.log('📝 Параметры ордера:', {
                symbol: params.symbol,
                side: params.side,
                type: params.type,
                quantity: params.quantity,
                positionSide: params.positionSide,
                price: params.price || 'MARKET'
            });

            const response = await this._signedRequest(
                'POST',
                '/openApi/swap/v3/trade/order',
                params
            );

            if (response && response.code === 0) {
                const orderData = response.data;
                console.log(`✅ Ордер создан: ${orderData.orderId}`);
                
                return {
                    orderId: orderData.orderId,
                    symbol: symbol,
                    side: side,
                    quantity: quantity,
                    price: price || parseFloat(orderData.price) || 0,
                    status: orderData.status || 'filled',
                    executedQty: parseFloat(orderData.executedQty) || 0,
                    avgPrice: parseFloat(orderData.avgPrice) || 0
                };
            }
            
            console.error('❌ BingX: Ошибка создания ордера', {
                code: response?.code,
                msg: response?.msg,
                fullResponse: response
            });
            return null;
        } catch (error) {
            console.error('❌ BingX: Ошибка placeOrder', {
                message: error.message,
                response: error.response?.data,
                stack: error.stack
            });
            return null;
        }
    }

    /**
     * Проверка действительности API ключей
     */
    async testCredentials() {
        try {
            const balance = await this.getBalance();
            const isValid = balance !== null && balance !== undefined;
            console.log(`🔑 Проверка ключей: ${isValid ? '✅ OK' : '❌ FAIL'}`);
            return isValid;
        } catch (error) {
            console.error('❌ Ошибка проверки ключей:', error.message);
            return false;
        }
    }

    /**
     * Отмена ордера
     */
    async cancelOrder(symbol, orderId) {
        try {
            const symbolFormatted = symbol.replace('-', '_');
            
            const params = {
                symbol: symbolFormatted,
                orderId: orderId,
                recvWindow: '5000'
            };

            const response = await this._signedRequest(
                'POST',
                '/openApi/swap/v3/trade/cancelOrder',
                params
            );

            if (response && response.code === 0) {
                console.log(`✅ Ордер ${orderId} отменён`);
                return true;
            }
            
            console.error('❌ Ошибка отмены ордера:', response);
            return false;
        } catch (error) {
            console.error('❌ Ошибка cancelOrder:', error.message);
            return false;
        }
    }

    /**
     * Получение информации о позиции
     */
    async getPosition(symbol) {
        try {
            const symbolFormatted = symbol.replace('-', '_');
            
            const params = {
                symbol: symbolFormatted,
                recvWindow: '5000'
            };

            const response = await this._signedRequest(
                'GET',
                '/openApi/swap/v3/position/list',
                params
            );

            if (response && response.code === 0) {
                const positions = response.data || [];
                const position = positions.find(p => p.symbol === symbolFormatted);
                
                if (position) {
                    return {
                        symbol: symbol,
                        size: parseFloat(position.positionAmt) || 0,
                        entryPrice: parseFloat(position.entryPrice) || 0,
                        markPrice: parseFloat(position.markPrice) || 0,
                        pnl: parseFloat(position.unRealizedProfit) || 0
                    };
                }
                return null;
            }
            
            console.error('❌ Ошибка получения позиции:', response);
            return null;
        } catch (error) {
            console.error('❌ Ошибка getPosition:', error.message);
            return null;
        }
    }
}

module.exports = BingXExchange;