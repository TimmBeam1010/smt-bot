const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const axios = require('axios');
const trading = require('./trading');
require('dotenv').config();

// === ИСПРАВЛЕНИЕ ДЛЯ WEBSOCKET (Node.js 20) ===
const WebSocket = require('ws');
global.WebSocket = WebSocket;
// =============================================

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Ошибка: SUPABASE_URL и SUPABASE_KEY должны быть указаны в .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log("✅ Подключение к Supabase установлено");

// ============================================
//  МАРШРУТЫ АВТОРИЗАЦИИ
// ============================================

app.post('/api/register', async (req, res) => {
    const { email, password, username } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email и пароль обязательны' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Пароль должен быть минимум 6 символов' });
    }

    try {
        const { data: existingUser } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .maybeSingle();

        if (existingUser) {
            return res.status(400).json({ error: 'Этот email уже зарегистрирован' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const { data: newUser, error: createError } = await supabase
            .from('users')
            .insert({
                email,
                password: hashedPassword,
                telegram_username: username || null,
                auth_provider: 'email',
                is_verified: true,
                is_active: true
            })
            .select()
            .single();

        if (createError) {
            console.error('Ошибка создания:', createError);
            return res.status(500).json({ error: 'Ошибка создания пользователя' });
        }

        delete newUser.password;
        res.status(201).json({ user: newUser });

    } catch (err) {
        console.error('Непредвиденная ошибка:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email и пароль обязательны' });
    }

    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .maybeSingle();

        if (error || !user) {
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }

        delete user.password;
        res.json({ user });

    } catch (err) {
        console.error('Непредвиденная ошибка:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// ============================================
//  АДМИН-МАРШРУТЫ
// ============================================

app.post('/api/admin/create-user', async (req, res) => {
    const { email, password, username } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email и пароль обязательны' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Пароль должен быть минимум 6 символов' });
    }

    try {
        const { data: existingUser } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .maybeSingle();

        if (existingUser) {
            return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const { data: newUser, error: createError } = await supabase
            .from('users')
            .insert({
                email,
                password: hashedPassword,
                telegram_username: username || null,
                auth_provider: 'email',
                is_verified: true,
                is_active: true
            })
            .select()
            .single();

        if (createError) {
            console.error('Ошибка создания:', createError);
            return res.status(500).json({ error: 'Ошибка создания пользователя' });
        }

        delete newUser.password;
        res.status(201).json({ user: newUser });

    } catch (err) {
        console.error('Непредвиденная ошибка:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from('users')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Ошибка получения пользователей:', error);
            return res.status(500).json({ error: 'Ошибка базы данных' });
        }

        const safeUsers = users.map(u => {
            delete u.password;
            return u;
        });

        res.json({ users: safeUsers });

    } catch (err) {
        console.error('Непредвиденная ошибка:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

app.put('/api/admin/users/:id', async (req, res) => {
    const { id } = req.params;
    const { is_active } = req.body;

    if (typeof is_active !== 'boolean') {
        return res.status(400).json({ error: 'is_active должен быть boolean' });
    }

    try {
        const { data: user, error } = await supabase
            .from('users')
            .update({ is_active, updated_at: new Date() })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('Ошибка обновления:', error);
            return res.status(500).json({ error: 'Ошибка обновления статуса' });
        }

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        delete user.password;
        res.json({ user });

    } catch (err) {
        console.error('Непредвиденная ошибка:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// ============================================
//  НОВОСТИ
// ============================================

app.get('/api/news', async (req, res) => {
    try {
        const apiKey = process.env.NEWS_API_KEY || 'demo';
        const url = `https://newsapi.org/v2/everything?q=crypto OR bitcoin OR trading&language=en&sortBy=publishedAt&apiKey=${apiKey}`;
        const response = await axios.get(url, { timeout: 10000 });
        const articles = response.data.articles?.slice(0, 6) || [];
        res.json({ news: articles });
    } catch (error) {
        console.error('❌ Ошибка получения новостей:', error.message);
        res.json({ news: [] });
    }
});

// ============================================
//  РЫНОЧНЫЕ ДАННЫЕ (ДАШБОРД)
// ============================================

app.get('/api/market-data', async (req, res) => {
    try {
        const fgRes = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 8000 });
        const fearGreed = parseInt(fgRes.data.data[0].value) || 50;

        const btcRes = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', { timeout: 8000 });
        const btcPrice = btcRes.data.bitcoin?.usd || null;

        const capRes = await axios.get('https://api.coingecko.com/api/v3/global', { timeout: 8000 });
        const totalCap = capRes.data.data?.total_market_cap?.usd || null;
        const totalCapStr = totalCap ? '$' + (totalCap / 1e12).toFixed(2) + 'T' : '--';

        res.json({
            fearGreed,
            btcPrice: btcPrice ? btcPrice.toLocaleString() : '--',
            totalCap: totalCapStr
        });
    } catch (error) {
        console.error('❌ Ошибка получения рыночных данных:', error.message);
        res.json({ fearGreed: 50, btcPrice: '--', totalCap: '--' });
    }
});

// ============================================
//  СИГНАЛЫ ПОЛЬЗОВАТЕЛЯ
// ============================================

app.get('/api/signals/user/:email', async (req, res) => {
    const { email } = req.params;
    try {
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const { data: signals, error } = await supabase
            .from('signals')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ signals });
    } catch (err) {
        console.error('Ошибка получения сигналов:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
//  ПРОВЕРКА СИГНАЛА
// ============================================

app.post('/api/signals/check/:id', async (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;

    try {
        const { data: signal, error } = await supabase
            .from('signals')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !signal) {
            return res.status(404).json({ error: 'Сигнал не найден' });
        }

        const currentPrice = await trading.getPrice(signal.symbol);
        if (!currentPrice) {
            return res.status(500).json({ error: 'Не удалось получить текущую цену' });
        }

        const entryPrice = parseFloat(signal.entry_price);
        const priceChange = ((currentPrice - entryPrice) / entryPrice) * 100;

        let status, message;

        if (signal.side === 'LONG') {
            if (priceChange > 0.5) {
                status = 'profit';
                message = `✅ Прибыль: +${priceChange.toFixed(2)}% (сейчас ${currentPrice})`;
            } else if (priceChange < -0.5) {
                status = 'loss';
                message = `❌ Убыток: ${priceChange.toFixed(2)}% (сейчас ${currentPrice})`;
            } else {
                status = 'active';
                message = `🟡 Актуально (изменение ${priceChange.toFixed(2)}%)`;
            }
        } else {
            if (priceChange < -0.5) {
                status = 'profit';
                message = `✅ Прибыль: ${Math.abs(priceChange).toFixed(2)}% (сейчас ${currentPrice})`;
            } else if (priceChange > 0.5) {
                status = 'loss';
                message = `❌ Убыток: -${priceChange.toFixed(2)}% (сейчас ${currentPrice})`;
            } else {
                status = 'active';
                message = `🟡 Актуально (изменение ${priceChange.toFixed(2)}%)`;
            }
        }

        await supabase
            .from('signals')
            .update({ checked: true, check_result: status, checked_at: new Date() })
            .eq('id', id);

        res.json({ status, message });

    } catch (err) {
        console.error('Ошибка проверки сигнала:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
//  ОБНОВЛЕНИЕ БОТОВ ПОЛЬЗОВАТЕЛЯ
// ============================================

app.put('/api/user/:email/bots', async (req, res) => {
    const { email } = req.params;
    const { bots } = req.body;

    if (!bots || !Array.isArray(bots)) {
        return res.status(400).json({ error: 'bots должен быть массивом' });
    }

    try {
        const { data: user, error } = await supabase
            .from('users')
            .update({ bots, updated_at: new Date() })
            .eq('email', email)
            .select()
            .single();

        if (error) {
            console.error('Ошибка обновления ботов:', error);
            return res.status(500).json({ error: 'Ошибка обновления ботов' });
        }

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        delete user.password;
        res.json({ user });

    } catch (err) {
        console.error('Непредвиденная ошибка:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// ============================================
//  ПОДКЛЮЧЕНИЕ БИРЖИ
// ============================================

app.post('/api/exchange/connect', async (req, res) => {
    const { email, exchange, apiKey, secretKey } = req.body;
    if (!email || !exchange || !apiKey || !secretKey) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }

    try {
        const { data: user, error } = await supabase
            .from('users')
            .update({
                exchange_connected: true,
                exchange_name: exchange,
                exchange_api_key: apiKey,
                exchange_secret_key: secretKey,
                updated_at: new Date()
            })
            .eq('email', email)
            .select()
            .single();

        if (error) throw error;
        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

        const currentBots = user.bots || [];
        const newBot = {
            exchange: exchange,
            tariff: 'Пользовательский',
            services: ['Сигналы'],
            active: true,
            paused: false,
            tariffEnd: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
            deposit: 0,
            pnl: 0,
            openTrades: 0,
            closedTrades: 0,
            activatedAt: new Date().toISOString()
        };

        const { data: updatedUser, error: updateError } = await supabase
            .from('users')
            .update({ bots: [...currentBots, newBot] })
            .eq('email', email)
            .select()
            .single();

        if (updateError) throw updateError;

        delete updatedUser.password;
        res.json({ success: true, user: updatedUser });

    } catch (err) {
        console.error('Ошибка подключения биржи:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
//  ДЕМО-БОТ
// ============================================

const demoSessions = {};

function getDemoSession(userId) {
    if (!demoSessions[userId]) {
        demoSessions[userId] = {
            balance: 1000,
            equity: 1000,
            positions: [],
            trades: [],
            totalPnl: 0,
            paused: false,
            active: true,
            testSignalSent: false // Флаг для тестового сигнала
        };
    }
    return demoSessions[userId];
}

function openDemoPosition(userId, symbol, side, entry, stopLoss, takeProfit, size) {
    const account = getDemoSession(userId);
    const position = {
        id: Date.now(),
        symbol,
        side,
        entry,
        stopLoss,
        takeProfit,
        size,
        openTime: new Date(),
        status: 'open'
    };
    account.positions.push(position);
    account.balance -= size;
    return position;
}

app.get('/api/demo/:userId', (req, res) => {
    const { userId } = req.params;
    const session = getDemoSession(userId);
    res.json({
        ok: true,
        data: {
            balance: session.balance,
            equity: session.equity,
            totalPnl: session.totalPnl,
            positions: session.positions.filter(p => p.status === 'open'),
            trades: session.trades.slice(-20)
        }
    });
});

app.post('/api/demo/action', (req, res) => {
    const { userId, action } = req.body;
    const session = getDemoSession(userId);
    if (action === 'pause') session.paused = true;
    if (action === 'resume') session.paused = false;
    if (action === 'stop') { session.active = false; session.positions = []; }
    if (action === 'start') { session.active = true; session.paused = false; }
    res.json({ ok: true });
});

// ============================================
//  ОСТАЛЬНЫЕ МАРШРУТЫ API
// ============================================

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'SMT Bot API работает!' });
});

app.get('/api/test-price/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const price = await trading.getPrice(symbol);
    if (price !== null) {
        res.json({ symbol, price });
    } else {
        res.status(500).json({ error: 'Не удалось получить цену' });
    }
});

app.get('/api/user/:email', async (req, res) => {
    const { email } = req.params;

    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .maybeSingle();

        if (error) {
            console.error('Ошибка получения:', error);
            return res.status(500).json({ error: 'Ошибка базы данных' });
        }

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        delete user.password;
        res.json({ user });

    } catch (err) {
        console.error('Непредвиденная ошибка:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

app.put('/api/user/:email/settings', async (req, res) => {
    const { email } = req.params;
    const { settings } = req.body;

    if (!settings) {
        return res.status(400).json({ error: 'Settings обязателен' });
    }

    try {
        const { data: user, error } = await supabase
            .from('users')
            .update({ settings, updated_at: new Date() })
            .eq('email', email)
            .select()
            .single();

        if (error) {
            console.error('Ошибка обновления:', error);
            return res.status(500).json({ error: 'Ошибка обновления настроек' });
        }

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        delete user.password;
        res.json({ user });

    } catch (err) {
        console.error('Непредвиденная ошибка:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// ============================================
//  ЧАТ-ЛОГИ (ПАМЯТЬ)
// ============================================

app.post('/api/chat/save', async (req, res) => {
    const { role, content, session_id } = req.body;
    if (!role || !content) {
        return res.status(400).json({ error: 'role и content обязательны' });
    }

    try {
        const { data, error } = await supabase
            .from('chat_logs')
            .insert({ role, content, session_id: session_id || 'default' })
            .select();
        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        console.error('❌ Ошибка сохранения чата:', err);
        res.status(500).json({ error: 'Ошибка сохранения' });
    }
});

app.get('/api/chat/history', async (req, res) => {
    const { session_id, limit = 50 } = req.query;

    try {
        const query = supabase
            .from('chat_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(parseInt(limit));

        if (session_id) {
            query.eq('session_id', session_id);
        }

        const { data, error } = await query;
        if (error) throw error;
        res.json({ history: data.reverse() });
    } catch (err) {
        console.error('❌ Ошибка получения истории:', err);
        res.status(500).json({ error: 'Ошибка получения истории' });
    }
});

app.get('/api/chat/export', async (req, res) => {
    const { limit = 20 } = req.query;
    try {
        const { data, error } = await supabase
            .from('chat_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(parseInt(limit));
        if (error) throw error;
        res.json({
            status: 'ok',
            count: data.length,
            history: data.reverse()
        });
    } catch (err) {
        console.error('❌ Ошибка экспорта чата:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
//  ПЛАНИРОВЩИК ТОРГОВОГО БОТА
// ============================================

const SYMBOLS = ['BONK-USDT', 'DOGS-USDT', 'PEPE-USDT', 'SOL-USDT', 'XRP-USDT'];
const priceHistory = {};

cron.schedule('*/1 * * * *', async () => {
    console.log('🔄 Запуск анализа рынка...');

    try {
        const prices = await trading.getPrices(SYMBOLS);
        console.log('📊 Получены цены:', prices);

        for (const symbol of SYMBOLS) {
            if (prices[symbol] !== undefined) {
                if (!priceHistory[symbol]) priceHistory[symbol] = [];
                priceHistory[symbol].push(prices[symbol]);
                if (priceHistory[symbol].length > 30) {
                    priceHistory[symbol].shift();
                }
            }
        }

        for (const symbol of SYMBOLS) {
            if (priceHistory[symbol] && priceHistory[symbol].length >= 5) {
                const signal = trading.generateSignal(symbol, priceHistory[symbol]);
                if (signal) {
                    console.log(`📈 СИГНАЛ: ${signal.symbol} ${signal.side} (${signal.confidence})`);

                    // Проверяем, есть ли активные боты у пользователя
                    const { data: users, error: userError } = await supabase
                        .from('users')
                        .select('id, bots')
                        .limit(1);

                    if (!userError && users && users.length > 0) {
                        const user = users[0];
                        const bots = user.bots || [];
                        const hasActiveBot = bots.some(b => b.active === true && b.paused !== true);
                        if (!hasActiveBot) {
                            console.log('⏸ Сигнал не отправлен: все боты на паузе или отключены');
                            return;
                        }
                    }

                    try {
                        const { data: users, error: userError } = await supabase
                            .from('users')
                            .select('id')
                            .limit(1);

                        if (!userError && users && users.length > 0) {
                            const userId = users[0].id;
                            const { error: insertError } = await supabase
                                .from('signals')
                                .insert({
                                    user_id: userId,
                                    symbol: signal.symbol,
                                    side: signal.side,
                                    entry_price: signal.entry,
                                    confidence: signal.confidence,
                                    rsi: signal.rsi,
                                    macd: signal.macd,
                                    reasons: signal.reasons,
                                });

                            if (insertError) {
                                console.error('❌ Ошибка сохранения сигнала:', insertError);
                            } else {
                                console.log(`✅ Сигнал сохранён в БД для пользователя ${userId}`);
                            }
                        } else {
                            console.warn('⚠️ Нет пользователей для сохранения сигнала');
                        }
                    } catch (dbError) {
                        console.error('❌ Ошибка БД:', dbError.message);
                    }

                    // === ДЕМО-ТОРГОВЛЯ ПО СИГНАЛУ ===
                    try {
                        const { data: user } = await supabase
                            .from('users')
                            .select('id, bots')
                            .eq('email', 'trnabiev@gmail.com')
                            .single();

                        if (user) {
                            const userId = user.id;
                            const bots = user.bots || [];
                            const hasDemoBot = bots.some(b => b.exchange === 'demo' && b.active === true && b.paused !== true);

                            if (hasDemoBot) {
                                const account = getDemoSession(userId);
                                const existing = account.positions.find(p => p.symbol === signal.symbol && p.status === 'open');
                                if (!existing) {
                                    const size = Math.min(account.balance * 0.05, 100);
                                    openDemoPosition(
                                        userId,
                                        signal.symbol,
                                        signal.side,
                                        signal.entry,
                                        signal.stopLoss,
                                        signal.takeProfit,
                                        size
                                    );
                                    console.log(`📊 ДЕМО: Открыта позиция ${signal.symbol} ${signal.side} (размер ${size} USDT)`);
                                }
                            }
                        }
                    } catch (demoError) {
                        console.error('❌ Ошибка демо-торговли:', demoError.message);
                    }
                }
            }
        }

        // === ПРИНУДИТЕЛЬНЫЙ ТЕСТОВЫЙ СИГНАЛ (ТОЛЬКО ОДИН РАЗ) ===
        try {
            const { data: user } = await supabase
                .from('users')
                .select('id, bots')
                .eq('email', 'trnabiev@gmail.com')
                .single();

            if (user) {
                const userId = user.id;
                const account = getDemoSession(userId);
                const hasOpen = account.positions.some(p => p.status === 'open');
                const testSignalSent = account.testSignalSent || false;

                if (!hasOpen && account.active && !account.paused && !testSignalSent) {
                    const testPrice = 0.00000420;
                    const testStop = 0.00000410;
                    const testProfit = 0.00000440;
                    const testSize = 50;

                    openDemoPosition(
                        userId,
                        'BONK-USDT',
                        'LONG',
                        testPrice,
                        testStop,
                        testProfit,
                        testSize
                    );
                    account.testSignalSent = true;
                    console.log('🧪 ДЕМО: Тестовая позиция BONK-USDT LONG открыта (принудительно, один раз)');
                }
            }
        } catch (testError) {
            console.error('❌ Ошибка тестового сигнала:', testError.message);
        }

    } catch (error) {
        console.error('❌ Ошибка анализа рынка:', error.message);
    }
}, {
    timezone: "Europe/Moscow"
});

console.log('⏰ Планировщик запущен (каждую минуту)');

// ============================================
//  ЗАПУСК СЕРВЕРА
// ============================================

app.listen(port, () => {
    console.log(`🚀 SMT Bot запущен на порту ${port}`);
    console.log(`🌐 Открой: http://localhost:${port}/`);
    console.log(`📡 API: http://localhost:${port}/api/health`);
});