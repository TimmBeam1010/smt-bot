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

async function getDemoBalance(userId) {
    const { data, error } = await supabase
        .from('demo_balance')
        .select('*')
        .eq('user_id', userId)
        .single();

    if (error && error.code === 'PGRST116') {
        const { data: newData, error: createError } = await supabase
            .from('demo_balance')
            .insert({ user_id: userId, balance: 1000 })
            .select()
            .single();
        if (createError) throw createError;
        return newData;
    }
    if (error) throw error;
    return data;
}

async function updateDemoBalance(userId, newBalance) {
    const { error } = await supabase
        .from('demo_balance')
        .update({ balance: newBalance, updated_at: new Date() })
        .eq('user_id', userId);
    if (error) throw error;
}

async function openDemoPosition(userId, symbol, side, entry, stopLoss, takeProfit, size) {
    const { data, error } = await supabase
        .from('demo_trades')
        .insert({
            user_id: userId,
            symbol,
            side,
            entry_price: entry,
            stop_loss: stopLoss,
            take_profit: takeProfit,
            size,
            status: 'open',
            open_time: new Date()
        })
        .select()
        .single();

    if (error) throw error;

    const balance = await getDemoBalance(userId);
    await updateDemoBalance(userId, balance.balance - size);

    return data;
}

app.get('/api/demo/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const { data: user } = await supabase
            .from('users')
            .select('id')
            .eq('email', userId)
            .single();

        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

        const balance = await getDemoBalance(user.id);
        const { data: positions, error: posError } = await supabase
            .from('demo_trades')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'open');

        const { data: trades, error: tradesError } = await supabase
            .from('demo_trades')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'closed')
            .order('close_time', { ascending: false })
            .limit(20);

        if (posError || tradesError) throw posError || tradesError;

        const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);

        res.json({
            ok: true,
            data: {
                balance: balance.balance,
                equity: balance.balance + positions.reduce((sum, p) => sum + (p.pnl || 0), 0),
                totalPnl: totalPnl,
                positions: positions,
                trades: trades
            }
        });
    } catch (err) {
        console.error('Ошибка демо-данных:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/demo/action', async (req, res) => {
    const { userId, action } = req.body;
    res.json({ ok: true });
});

// ============================================
//  РУЧНОЕ ОТКРЫТИЕ ПОЗИЦИИ
// ============================================

app.post('/api/trade/open-manual', async (req, res) => {
    const { userId, signalId, bots } = req.body;
    if (!userId || !signalId || !bots || bots.length === 0) {
        return res.status(400).json({ error: 'Недостаточно данных' });
    }

    try {
        const { data: signal, error: signalError } = await supabase
            .from('signals')
            .select('*')
            .eq('id', signalId)
            .single();

        if (signalError || !signal) {
            return res.status(404).json({ error: 'Сигнал не найден' });
        }

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, bots')
            .eq('email', userId)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const results = [];

        for (const bot of bots) {
            if (bot.exchange === 'demo') {
                const balance = await getDemoBalance(user.id);
                const size = Math.min(balance.balance * 0.05, 100);
                const position = await openDemoPosition(
                    user.id,
                    signal.symbol,
                    signal.side,
                    signal.entry_price,
                    signal.stop_loss || signal.entry_price * 0.97,
                    signal.take_profit || signal.entry_price * 1.05,
                    size
                );
                results.push({ bot: 'demo', position });
            } else {
                results.push({ bot: bot.exchange, status: 'real_trade_not_implemented' });
            }
        }

        res.json({ success: true, results });

    } catch (err) {
        console.error('Ошибка ручного открытия:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
//  PNL В РЕАЛЬНОМ ВРЕМЕНИ
// ============================================

app.get('/api/pnl/:email', async (req, res) => {
    const { email } = req.params;
    try {
        const { data: user } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

        // Получаем демо-баланс
        const balance = await getDemoBalance(user.id);
        const { data: positions } = await supabase
            .from('demo_trades')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'open');

        const totalPnl = positions.reduce((sum, p) => sum + (p.pnl || 0), 0);

        res.json({
            balance: balance.balance,
            totalPnl: totalPnl,
            openPositions: positions.length
        });
    } catch (err) {
        console.error('Ошибка получения PNL:', err);
        res.status(500).json({ error: err.message });
    }
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

                    // === ДЕМО-ТОРГОВЛЯ ===
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
                                const balance = await getDemoBalance(userId);
                                const { data: openPositions } = await supabase
                                    .from('demo_trades')
                                    .select('*')
                                    .eq('user_id', userId)
                                    .eq('status', 'open');

                                const existing = openPositions.find(p => p.symbol === signal.symbol);
                                if (!existing) {
                                    const size = Math.min(balance.balance * 0.05, 100);
                                    await openDemoPosition(
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

        // === ТЕСТОВЫЙ СИГНАЛ ===
        try {
            const { data: user } = await supabase
                .from('users')
                .select('id, bots')
                .eq('email', 'trnabiev@gmail.com')
                .single();

            if (user) {
                const userId = user.id;
                const balance = await getDemoBalance(userId);
                const { data: openPositions } = await supabase
                    .from('demo_trades')
                    .select('*')
                    .eq('user_id', userId)
                    .eq('status', 'open');

                const hasOpen = openPositions.length > 0;
                const bots = user.bots || [];
                const hasDemoBot = bots.some(b => b.exchange === 'demo' && b.active === true && b.paused !== true);

                if (!hasOpen && hasDemoBot && balance.balance >= 50) {
                    const testPrice = 0.00000420;
                    const testStop = 0.00000410;
                    const testProfit = 0.00000440;
                    const testSize = 50;

                    await openDemoPosition(
                        userId,
                        'BONK-USDT',
                        'LONG',
                        testPrice,
                        testStop,
                        testProfit,
                        testSize
                    );
                    console.log('🧪 ДЕМО: Тестовая позиция BONK-USDT LONG открыта');
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