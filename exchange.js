// ============================================
//  МОДУЛЬ РАБОТЫ С БИРЖАМИ
// ============================================

const crypto = require('crypto');
const axios = require('axios');

// ============================================
//  ШИФРОВАНИЕ API КЛЮЧЕЙ
// ============================================

const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'your-secret-key-change-me';
const algorithm = 'aes-256-cbc';
const key = crypto.scryptSync(ENCRYPTION_SECRET, 'salt', 32);

function encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return { encrypted, iv: iv.toString('hex') };
}

function decrypt(encrypted, ivHex) {
    const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(ivHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// ============================================
//  ПРОВЕРКА API КЛЮЧЕЙ
// ============================================

async function testExchangeCredentials(exchange, apiKey, secretKey) {
    try {
        switch (exchange) {
            case 'binance':
                return await testBinance(apiKey, secretKey);
            case 'bybit':
                return await testBybit(apiKey, secretKey);
            case 'okx':
                return await testOKX(apiKey, secretKey);
            case 'bingx':
                return await testBingX(apiKey, secretKey);
            default:
                return false;
        }
    } catch (error) {
        console.error(`❌ Ошибка проверки ${exchange}:`, error.message);
        return false;
    }
}

async function testBinance(apiKey, secretKey) {
    const timestamp = Date.now();
    const signature = crypto.createHmac('sha256', secretKey)
        .update(`timestamp=${timestamp}&recvWindow=5000`)
        .digest('hex');
    const response = await axios.get(
        `https://api.binance.com/api/v3/account?timestamp=${timestamp}&signature=${signature}`,
        { headers: { 'X-MBX-APIKEY': apiKey }, timeout: 10000 }
    );
    return response.status === 200;
}

async function testBybit(apiKey, secretKey) {
    const timestamp = Date.now().toString();
    const recvWindow = '5000';
    const signature = crypto.createHmac('sha256', secretKey)
        .update(`${timestamp}${apiKey}${recvWindow}`)
        .digest('hex');
    const response = await axios.get(
        `https://api.bybit.com/v5/account/wallet-balance?accountType=UNIFIED&timestamp=${timestamp}&recvWindow=${recvWindow}&sign=${signature}`,
        { headers: { 'X-BAPI-API-KEY': apiKey }, timeout: 10000 }
    );
    return response.status === 200 && response.data.retCode === 0;
}

async function testOKX(apiKey, secretKey) {
    const timestamp = new Date().toISOString();
    const method = 'GET';
    const path = '/api/v5/account/balance';
    const signature = crypto.createHmac('sha256', secretKey)
        .update(timestamp + method + path)
        .digest('base64');
    const response = await axios.get(
        `https://www.okx.com${path}`,
        {
            headers: {
                'OK-ACCESS-KEY': apiKey,
                'OK-ACCESS-SIGN': signature,
                'OK-ACCESS-TIMESTAMP': timestamp,
                'OK-ACCESS-PASSPHRASE': process.env.OKX_PASSPHRASE || ''
            },
            timeout: 10000
        }
    );
    return response.status === 200 && response.data.code === '0';
}

async function testBingX(apiKey, secretKey) {
    const timestamp = Date.now().toString();
    const signature = crypto.createHmac('sha256', secretKey)
        .update(timestamp)
        .digest('hex');
    const response = await axios.get(
        `https://open-api.bingx.com/openApi/spot/v1/account`,
        {
            headers: {
                'X-BX-APIKEY': apiKey,
                'X-BX-SIGNATURE': signature,
                'X-BX-TIMESTAMP': timestamp
            },
            timeout: 10000
        }
    );
    return response.status === 200;
}

// ============================================
//  ВРЕМЕННАЯ ЭМУЛЯЦИЯ ПОДКЛЮЧЕНИЯ БИРЖИ
// ============================================

async function forceConnectExchange(email, exchange, supabase) {
    const { data: user, error } = await supabase
        .from('users')
        .select('exchange_credentials, connected_exchanges')
        .eq('email', email)
        .single();

    if (error || !user) {
        throw new Error('Пользователь не найден');
    }

    const credentials = user.exchange_credentials || {};
    credentials[exchange] = {
        enabled: true,
        last_checked: new Date().toISOString(),
        test_mode: true
    };

    const connectedExchanges = user.connected_exchanges || [];
    if (!connectedExchanges.includes(exchange)) {
        connectedExchanges.push(exchange);
    }

    const { error: updateError } = await supabase
        .from('users')
        .update({
            exchange_credentials: credentials,
            connected_exchanges: connectedExchanges
        })
        .eq('email', email);

    if (updateError) throw updateError;

    return { success: true, message: `Биржа ${exchange} принудительно подключена (тестовый режим)` };
}

module.exports = {
    encrypt,
    decrypt,
    testExchangeCredentials,
    forceConnectExchange
};