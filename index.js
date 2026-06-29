const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const axios = require('axios');
const trading = require('./trading');
const ccxt = require('ccxt');
require('dotenv').config();

const WebSocket = require('ws');
global.WebSocket = WebSocket;

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

const server = app.listen(port, () => {
    console.log(`🚀 SMT Bot запущен на порту ${port}`);
    console.log(`🌐 Открой: http://localhost:${port}/`);
    console.log(`📡 API: http://localhost:${port}/api/health`);
    console.log(`🔌 WebSocket: ws://localhost:${port}/ws`);
});

const wss = new WebSocket.Server({ server });
const clients = new Map();

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const userId = url.searchParams.get('userId');
    if (userId) {
        clients.set(userId, ws);
        console.log(`✅ Пользователь ${userId} подключен к WebSocket`);
    }

    ws.on('close', () => {
        if (userId) {
            clients.delete(userId);
            console.log(`❌ Пользователь ${userId} отключен`);
        }
    });
});

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

async function broadcastPnlUpdate(email) {
    try {
        const { data: user } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (!user) return null;

        const balance = await getDemoBalance(user.id);
        const { data: openPositions } = await supabase
            .from('demo_trades')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'open');

        const { data: closedTrades } = await supabase
            .from('demo_trades')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'closed')
            .order('close_time', { ascending: false });

        let totalPnl = 0;
        const positionsWithPnl = await Promise.all((openPositions || []).map(async (pos) => {
            const currentPrice = await trading.getPrice(pos.symbol);
            if (!currentPrice) return { ...pos, pnl: 0, pnlPercent: 0, currentPrice: null };
            
            let pnl = 0;
            if (pos.side === 'LONG') {
                pnl = (currentPrice - pos.entry_price) * pos.size;
            } else {
                pnl = (pos.entry_price - currentPrice) * pos.size;
            }
            
            totalPnl += pnl;
            return {
                ...pos,
                pnl: pnl,
                pnlPercent: (pnl / (pos.entry_price * pos.size)) * 100,
                currentPrice: currentPrice
            };
        }));

        const currentBalance = balance.balance + totalPnl;
        const initialBalance = balance.balance - totalPnl;

        const totalTrades = (closedTrades?.length || 0) + (openPositions?.length || 0);
        const winTrades = (closedTrades || []).filter(t => t.pnl > 0).length;
        const lossTrades = (closedTrades || []).filter(t => t.pnl < 0).length;
        const winRate = (closedTrades || []).length > 0 ? (winTrades / (closedTrades || []).length * 100).toFixed(1) : 0;

        const pnlData = {
            userId: user.id,
            email: email,
            balance: {
                initial: initialBalance,
                current: currentBalance,
                change: totalPnl,
                changePercent: initialBalance > 0 ? ((currentBalance / initialBalance) - 1) * 100 : 0
            },
            positions: positionsWithPnl,
            trades: {
                total: totalTrades,
                open: (openPositions || []).length,
                closed: (closedTrades || []).length,
                wins: winTrades,
                losses: lossTrades,
                winRate: parseFloat(winRate),
                totalPnl: (closedTrades || []).reduce((sum, t) => sum + (t.pnl || 0), 0)
            },
            recentTrades: (closedTrades || []).slice(0, 10),
            timestamp: new Date().toISOString()
        };

        const client = clients.get(email);
        if (client && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(pnlData));
        }

        return pnlData;
    } catch (err) {
        console.error('❌ Ошибка обновления PNL:', err);
        return null;
    }
}

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
            const isPasswordValid = await bcrypt.compare(password, existingUser.password);
            if (!isPasswordValid) {
                const hashedPassword = await bcrypt.hash(password, 10);
                await supabase
                    .from('users')
                    .update({ password: hashedPassword, updated_at: new Date() })
                    .eq('email', email);
            }
            delete existingUser.password;
            return res.status(200).json({ user: existingUser, message: 'Пользователь уже существует' });
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

app.put('/api/user/:email/exchanges', async (req, res) => {
    const { email } = req.params;
    const { exchanges } = req.body;

    console.log('📥 Запрос на сохранение бирж для:', email);
    console.log('📦 Данные:', JSON.stringify(exchanges, null, 2));

    if (!exchanges || !Array.isArray(exchanges)) {
        console.log('❌ Ошибка: exchanges не массив');
        return res.status(400).json({ error: 'exchanges должен быть массивом' });
    }

    try {
        const encryptedExchanges = exchanges.map(ex => {
            const newEx = { ...ex };
            if (newEx.secret_key && !newEx.secret_key.startsWith('base64:')) {
                newEx.secret_key = 'base64:' + Buffer.from(newEx.secret_key).toString('base64');
            }
            return newEx;
        });

        console.log('🔐 Зашифрованные данные:', JSON.stringify(encryptedExchanges, null, 2));

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, email')
            .eq('email', email)
            .maybeSingle();

        if (userError) {
            console.error('❌ Ошибка поиска пользователя:', userError);
            return res.status(500).json({ error: 'Ошибка поиска пользователя' });
        }

        if (!user) {
            console.log('❌ Пользователь не найден:', email);
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        console.log('✅ Пользователь найден:', user.id);

        const { data: updatedUser, error: updateError } = await supabase
            .from('users')
            .update({ 
                exchanges: encryptedExchanges, 
                updated_at: new Date().toISOString() 
            })
            .eq('id', user.id)
            .select('*');

        if (updateError) {
            console.error('❌ Ошибка обновления:', updateError);
            return res.status(500).json({ error: 'Ошибка обновления бирж: ' + updateError.message });
        }

        console.log('✅ Биржи сохранены успешно');

        if (updatedUser && updatedUser[0]) {
            const userData = updatedUser[0];
            delete userData.password;
            res.json({ user: userData });
        } else {
            res.json({ user: user });
        }

    } catch (err) {
        console.error('❌ Непредвиденная ошибка:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера: ' + err.message });
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

app.get('/api/signals/user/:email', async (req, res) => {
    const { email } = req.params;
    try {
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (userError || !user) {
            return res.json({ signals: [] });
        }

        const { data: signals, error } = await supabase
            .from('signals')
            .select('*')
            .eq('email', email)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ signals });
    } catch (err) {
        console.error('Ошибка получения сигналов:', err);
        res.status(500).json({ error: err.message });
    }
});

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
        const { data: openPositions, error: posError } = await supabase
            .from('demo_trades')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'open');

        const { data: closedTrades, error: tradesError } = await supabase
            .from('demo_trades')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'closed')
            .order('close_time', { ascending: false })
            .limit(50);

        if (posError || tradesError) throw posError || tradesError;

        let totalPnl = 0;
        const positionsWithPnl = await Promise.all((openPositions || []).map(async (pos) => {
            const currentPrice = await trading.getPrice(pos.symbol);
            if (!currentPrice) return { ...pos, pnl: 0, pnlPercent: 0, currentPrice: null };
            
            let pnl = 0;
            if (pos.side === 'LONG') {
                pnl = (currentPrice - pos.entry_price) * pos.size;
            } else {
                pnl = (pos.entry_price - currentPrice) * pos.size;
            }
            
            totalPnl += pnl;
            return {
                ...pos,
                pnl: pnl,
                pnlPercent: (pnl / (pos.entry_price * pos.size)) * 100,
                currentPrice: currentPrice
            };
        }));

        const currentBalance = balance.balance + totalPnl;
        const initialBalance = balance.balance - totalPnl;

        const totalTrades = (closedTrades?.length || 0) + (openPositions?.length || 0);
        const winTrades = (closedTrades || []).filter(t => t.pnl > 0).length;
        const lossTrades = (closedTrades || []).filter(t => t.pnl < 0).length;

        res.json({
            ok: true,
            data: {
                balance: {
                    initial: initialBalance,
                    current: currentBalance,
                    change: totalPnl,
                    changePercent: initialBalance > 0 ? ((currentBalance / initialBalance) - 1) * 100 : 0
                },
                positions: positionsWithPnl,
                trades: {
                    total: totalTrades,
                    open: (openPositions || []).length,
                    closed: (closedTrades || []).length,
                    wins: winTrades,
                    losses: lossTrades,
                    winRate: (closedTrades || []).length > 0 ? (winTrades / (closedTrades || []).length * 100).toFixed(1) : 0,
                    totalPnl: (closedTrades || []).reduce((sum, t) => sum + (t.pnl || 0), 0)
                },
                recentTrades: (closedTrades || []).slice(0, 10)
            }
        });
    } catch (err) {
        console.error('❌ Ошибка демо-данных:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/demo/action', async (req, res) => {
    const { userId, action } = req.body;
    res.json({ ok: true });
});

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
                await broadcastPnlUpdate(userId);
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

app.post('/api/trade/close', async (req, res) => {
    const { positionId, email } = req.body;
    if (!positionId || !email) {
        return res.status(400).json({ error: 'positionId и email обязательны' });
    }

    try {
        const { data: position, error: posError } = await supabase
            .from('demo_trades')
            .select('*')
            .eq('id', positionId)
            .single();

        if (posError || !position) {
            return res.status(404).json({ error: 'Позиция не найдена' });
        }

        const currentPrice = await trading.getPrice(position.symbol);
        if (!currentPrice) {
            return res.status(500).json({ error: 'Не удалось получить текущую цену' });
        }

        let pnl = 0;
        if (position.side === 'LONG') {
            pnl = (currentPrice - position.entry_price) * position.size;
        } else {
            pnl = (position.entry_price - currentPrice) * position.size;
        }

        const { data: closedPosition, error: closeError } = await supabase
            .from('demo_trades')
            .update({
                status: 'closed',
                close_price: currentPrice,
                pnl: pnl,
                pnl_percent: (pnl / (position.entry_price * position.size)) * 100,
                close_time: new Date()
            })
            .eq('id', positionId)
            .select()
            .single();

        if (closeError) throw closeError;

        const { data: user } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (user) {
            const balance = await getDemoBalance(user.id);
            await updateDemoBalance(user.id, balance.balance + pnl);
        }

        await broadcastPnlUpdate(email);

        res.json({ 
            success: true, 
            position: closedPosition,
            pnl: pnl,
            currentPrice: currentPrice
        });

    } catch (err) {
        console.error('❌ Ошибка закрытия позиции:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/pnl/realtime/:email', async (req, res) => {
    const { email } = req.params;
    try {
        const data = await broadcastPnlUpdate(email);
        if (data) {
            res.json({ success: true, data });
        } else {
            res.status(404).json({ error: 'Пользователь не найден' });
        }
    } catch (err) {
        console.error('❌ Ошибка получения PNL:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/exchanges/list', (req, res) => {
    const exchanges = [
        { id: 'binance', name: 'Binance', logo: '🟡', docs: 'https://binance-docs.github.io/apidocs/' },
        { id: 'bybit', name: 'Bybit', logo: '🔵', docs: 'https://bybit-exchange.github.io/docs/' },
        { id: 'okx', name: 'OKX', logo: '🔴', docs: 'https://www.okx.com/docs/' },
        { id: 'gateio', name: 'Gate.io', logo: '🟣', docs: 'https://gate.io/docs' },
        { id: 'kucoin', name: 'KuCoin', logo: '🟢', docs: 'https://docs.kucoin.com/' },
        { id: 'kraken', name: 'Kraken', logo: '🟠', docs: 'https://docs.kraken.com/' },
        { id: 'bitget', name: 'Bitget', logo: '🟡', docs: 'https://bitget-docs.github.io/' },
        { id: 'htx', name: 'HTX (Huobi)', logo: '🔵', docs: 'https://www.htx.com/docs/' },
        { id: 'mexc', name: 'MEXC', logo: '🔴', docs: 'https://mexc-docs.github.io/' },
        { id: 'bingx', name: 'BingX', logo: '🟣', docs: 'https://bingx-api.github.io/docs/' },
        { id: 'coinex', name: 'CoinEx', logo: '🟢', docs: 'https://coinex-docs.github.io/' },
        { id: 'bitmex', name: 'BitMEX', logo: '🔵', docs: 'https://www.bitmex.com/api/' },
        { id: 'crypto_com', name: 'Crypto.com', logo: '🔴', docs: 'https://exchange-docs.crypto.com/' },
        { id: 'upbit', name: 'Upbit', logo: '🟣', docs: 'https://docs.upbit.com/' },
        { id: 'whitebit', name: 'WhiteBit', logo: '🟢', docs: 'https://whitebit-exchange.github.io/api/' },
        { id: 'exmo', name: 'EXMO', logo: '🟠', docs: 'https://exmo.com/en/api' },
        { id: 'bitfinex', name: 'Bitfinex', logo: '🟡', docs: 'https://docs.bitfinex.com/' },
        { id: 'phemex', name: 'Phemex', logo: '🔵', docs: 'https://phemex-docs.github.io/' }
    ];
    res.json({ exchanges });
});

async function getExchangeInstance(exchangeId, apiKey, secretKey) {
    try {
        const exchangeClass = new ccxt[exchangeId]();
        if (!exchangeClass) {
            throw new Error(`Биржа ${exchangeId} не поддерживается`);
        }
        exchangeClass.apiKey = apiKey;
        exchangeClass.secret = secretKey;
        exchangeClass.enableRateLimit = true;
        exchangeClass.timeout = 30000;
        return exchangeClass;
    } catch (err) {
        throw new Error(`Ошибка инициализации биржи: ${err.message}`);
    }
}

app.post('/api/exchange/test', async (req, res) => {
    const { exchange, apiKey, secretKey } = req.body;

    console.log('📥 Проверка подключения к:', exchange);

    if (!exchange || !apiKey || !secretKey) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }

    try {
        const exchangeInstance = await getExchangeInstance(exchange, apiKey, secretKey);
        
        const balance = await exchangeInstance.fetchBalance();
        const totalBalance = balance.total;
        
        let hasTradingPermissions = false;
        try {
            const orders = await exchangeInstance.fetchOpenOrders();
            hasTradingPermissions = Array.isArray(orders);
        } catch (e) {
            console.log('Нет прав на чтение ордеров:', e.message);
        }

        const assets = Object.keys(totalBalance).filter(key => totalBalance[key] > 0);

        res.json({
            success: true,
            balance: totalBalance,
            total: parseFloat(Object.values(totalBalance).reduce((a, b) => a + b, 0).toFixed(2)),
            assets: assets,
            hasTradingPermissions: hasTradingPermissions,
            message: `✅ Подключение к ${exchange} успешно`,
            exchangeInfo: {
                name: exchangeInstance.name,
                id: exchangeInstance.id,
                urls: exchangeInstance.urls
            }
        });

    } catch (err) {
        console.error('❌ Ошибка проверки подключения:', err);
        res.status(500).json({ 
            success: false,
            error: err.message || 'Ошибка подключения к бирже'
        });
    }
});

app.get('/api/exchange/balance/:email/:exchangeId', async (req, res) => {
    const { email, exchangeId } = req.params;

    try {
        const { data: user } = await supabase
            .from('users')
            .select('exchanges')
            .eq('email', email)
            .single();

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const exchange = user.exchanges?.find(ex => ex.id === exchangeId);
        if (!exchange || !exchange.api_key || !exchange.secret_key) {
            return res.status(404).json({ error: 'Биржа не найдена или не настроена' });
        }

        let secretKey = exchange.secret_key;
        if (secretKey.startsWith('base64:')) {
            secretKey = Buffer.from(secretKey.replace('base64:', ''), 'base64').toString();
        }

        const exchangeInstance = await getExchangeInstance(exchangeId, exchange.api_key, secretKey);

        const balance = await exchangeInstance.fetchBalance();
        const totalBalance = balance.total;
        const freeBalance = balance.free;
        const usedBalance = balance.used;

        res.json({
            success: true,
            exchange: exchangeId,
            balance: {
                total: totalBalance,
                free: freeBalance,
                used: usedBalance
            },
            assets: Object.keys(totalBalance).filter(key => totalBalance[key] > 0),
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('❌ Ошибка получения баланса:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/exchange/positions/:email/:exchangeId', async (req, res) => {
    const { email, exchangeId } = req.params;

    try {
        const { data: user } = await supabase
            .from('users')
            .select('exchanges')
            .eq('email', email)
            .single();

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const exchange = user.exchanges?.find(ex => ex.id === exchangeId);
        if (!exchange || !exchange.api_key || !exchange.secret_key) {
            return res.status(404).json({ error: 'Биржа не найдена или не настроена' });
        }

        let secretKey = exchange.secret_key;
        if (secretKey.startsWith('base64:')) {
            secretKey = Buffer.from(secretKey.replace('base64:', ''), 'base64').toString();
        }

        const exchangeInstance = await getExchangeInstance(exchangeId, exchange.api_key, secretKey);

        let positions = [];
        let openOrders = [];

        try {
            if (exchangeInstance.has['fetchPositions']) {
                positions = await exchangeInstance.fetchPositions();
            }
        } catch (e) {
            console.log('Не удалось получить позиции:', e.message);
        }

        try {
            openOrders = await exchangeInstance.fetchOpenOrders();
        } catch (e) {
            console.log('Не удалось получить открытые ордера:', e.message);
        }

        res.json({
            success: true,
            exchange: exchangeId,
            positions: positions,
            openOrders: openOrders,
            count: {
                positions: positions.length,
                orders: openOrders.length
            },
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('❌ Ошибка получения позиций:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/exchange/trades/:email/:exchangeId', async (req, res) => {
    const { email, exchangeId } = req.params;
    const { symbol, limit = 50 } = req.query;

    try {
        const { data: user } = await supabase
            .from('users')
            .select('exchanges')
            .eq('email', email)
            .single();

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const exchange = user.exchanges?.find(ex => ex.id === exchangeId);
        if (!exchange || !exchange.api_key || !exchange.secret_key) {
            return res.status(404).json({ error: 'Биржа не найдена или не настроена' });
        }

        let secretKey = exchange.secret_key;
        if (secretKey.startsWith('base64:')) {
            secretKey = Buffer.from(secretKey.replace('base64:', ''), 'base64').toString();
        }

        const exchangeInstance = await getExchangeInstance(exchangeId, exchange.api_key, secretKey);

        let trades = [];
        try {
            if (symbol) {
                trades = await exchangeInstance.fetchMyTrades(symbol, undefined, parseInt(limit));
            } else {
                const markets = await exchangeInstance.loadMarkets();
                const symbols = Object.keys(markets).slice(0, 5);
                for (const sym of symbols) {
                    try {
                        const t = await exchangeInstance.fetchMyTrades(sym, undefined, 10);
                        trades = trades.concat(t);
                    } catch (e) {}
                }
                trades = trades.slice(0, parseInt(limit));
            }
        } catch (e) {
            console.log('Не удалось получить историю сделок:', e.message);
        }

        res.json({
            success: true,
            exchange: exchangeId,
            trades: trades,
            count: trades.length,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('❌ Ошибка получения истории сделок:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/exchange/trade', async (req, res) => {
    const { email, exchangeId, symbol, side, amount, price, type = 'limit' } = req.body;

    if (!email || !exchangeId || !symbol || !side || !amount) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }

    try {
        const { data: user } = await supabase
            .from('users')
            .select('id, exchanges')
            .eq('email', email)
            .single();

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const exchange = user.exchanges?.find(ex => ex.id === exchangeId);
        if (!exchange || !exchange.api_key || !exchange.secret_key) {
            return res.status(404).json({ error: 'Биржа не найдена или не настроена' });
        }

        let secretKey = exchange.secret_key;
        if (secretKey.startsWith('base64:')) {
            secretKey = Buffer.from(secretKey.replace('base64:', ''), 'base64').toString();
        }

        const exchangeInstance = await getExchangeInstance(exchangeId, exchange.api_key, secretKey);

        const balance = await exchangeInstance.fetchBalance();
        const freeAmount = balance.free[symbol.split('/')[0]] || 0;
        
        if (side === 'buy' && freeAmount < amount) {
            return res.status(400).json({ 
                error: 'Недостаточно средств',
                available: freeAmount,
                required: amount
            });
        }

        const order = await exchangeInstance.createOrder(
            symbol,
            type,
            side,
            amount,
            price || undefined
        );

        await supabase
            .from('trades')
            .insert({
                user_id: user.id,
                exchange_id: exchangeId,
                symbol: symbol,
                side: side,
                type: type,
                amount: amount,
                price: order.price || price || 0,
                order_id: order.id,
                status: order.status || 'open',
                created_at: new Date(),
                raw_order: order
            });

        res.json({
            success: true,
            order: order,
            message: `✅ Ордер ${side} ${symbol} создан`,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('❌ Ошибка торговли:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/exchange/trade/:email/:exchangeId/:orderId', async (req, res) => {
    const { email, exchangeId, orderId } = req.params;
    const { symbol } = req.query;

    if (!symbol) {
        return res.status(400).json({ error: 'Необходимо указать символ' });
    }

    try {
        const { data: user } = await supabase
            .from('users')
            .select('exchanges')
            .eq('email', email)
            .single();

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const exchange = user.exchanges?.find(ex => ex.id === exchangeId);
        if (!exchange || !exchange.api_key || !exchange.secret_key) {
            return res.status(404).json({ error: 'Биржа не найдена или не настроена' });
        }

        let secretKey = exchange.secret_key;
        if (secretKey.startsWith('base64:')) {
            secretKey = Buffer.from(secretKey.replace('base64:', ''), 'base64').toString();
        }

        const exchangeInstance = await getExchangeInstance(exchangeId, exchange.api_key, secretKey);

        const result = await exchangeInstance.cancelOrder(orderId, symbol);

        await supabase
            .from('trades')
            .update({ 
                status: 'canceled',
                updated_at: new Date()
            })
            .eq('order_id', orderId);

        res.json({
            success: true,
            message: `✅ Ордер ${orderId} отменен`,
            result: result,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('❌ Ошибка отмены ордера:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/bot/create', async (req, res) => {
    const { email, exchangeId, name, strategy, deposit, apiKey, secretKey, autoUseExisting } = req.body;

    console.log('📥 Создание бота для:', email);
    console.log('📦 Данные:', { exchangeId, name, strategy, deposit, autoUseExisting });

    if (!email || !exchangeId || !name) {
        return res.status(400).json({ error: 'email, exchangeId и name обязательны' });
    }

    try {
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .maybeSingle();

        if (userError || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        let userExchanges = user.exchanges || [];
        let finalApiKey = null;
        let finalSecretKey = null;

        const existingExchange = userExchanges.find(ex => ex.id === exchangeId);
        const isConnected = existingExchange && existingExchange.api_key && existingExchange.secret_key;

        if (autoUseExisting && isConnected) {
            finalApiKey = existingExchange.api_key;
            finalSecretKey = existingExchange.secret_key;
            console.log('✅ Используем существующие ключи для биржи:', exchangeId);
        } else if (apiKey && secretKey) {
            finalApiKey = apiKey;
            finalSecretKey = secretKey;

            const exchangeLogo = {
                'binance': '🟡', 'bybit': '🔵', 'okx': '🔴', 'gateio': '🟣',
                'kucoin': '🟢', 'kraken': '🟠', 'bitget': '🟡', 'htx': '🔵',
                'mexc': '🔴', 'bingx': '🟣', 'coinex': '🟢', 'bitmex': '🔵',
                'crypto_com': '🔴', 'upbit': '🟣', 'whitebit': '🟢', 'exmo': '🟠',
                'bitfinex': '🟡', 'phemex': '🔵'
            };

            const exchangeName = {
                'binance': 'Binance', 'bybit': 'Bybit', 'okx': 'OKX',
                'gateio': 'Gate.io', 'kucoin': 'KuCoin', 'kraken': 'Kraken',
                'bitget': 'Bitget', 'htx': 'HTX (Huobi)', 'mexc': 'MEXC',
                'bingx': 'BingX', 'coinex': 'CoinEx', 'bitmex': 'BitMEX',
                'crypto_com': 'Crypto.com', 'upbit': 'Upbit', 'whitebit': 'WhiteBit',
                'exmo': 'EXMO', 'bitfinex': 'Bitfinex', 'phemex': 'Phemex'
            };

            const newExchange = {
                id: exchangeId,
                name: exchangeName[exchangeId] || exchangeId,
                logo: exchangeLogo[exchangeId] || '🏦',
                api_key: apiKey,
                secret_key: secretKey,
                connected: true,
                updated_at: new Date().toISOString()
            };

            const existingIndex = userExchanges.findIndex(ex => ex.id === exchangeId);
            if (existingIndex >= 0) {
                userExchanges[existingIndex] = newExchange;
            } else {
                userExchanges.push(newExchange);
            }

            await supabase
                .from('users')
                .update({ exchanges: userExchanges, updated_at: new Date().toISOString() })
                .eq('id', user.id);

            console.log('✅ Биржа добавлена в подключенные:', exchangeId);
        } else {
            return res.status(400).json({ error: 'Требуются API-ключи' });
        }

        const bots = user.bots || [];
        const newBot = {
            id: Date.now().toString(),
            exchange: exchangeId,
            name: name,
            strategy: strategy,
            deposit: deposit,
            apiKey: finalApiKey ? '***' : null,
            active: true,
            paused: false,
            createdAt: new Date().toISOString(),
            tariff: 'Пользовательский',
            services: ['Сигналы'],
            tariffEnd: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
            pnl: 0,
            openTrades: 0,
            closedTrades: 0
        };

        bots.push(newBot);

        const { data: updatedUser, error: updateError } = await supabase
            .from('users')
            .update({ bots: bots, updated_at: new Date().toISOString() })
            .eq('id', user.id)
            .select();

        if (updateError) {
            console.error('❌ Ошибка сохранения бота:', updateError);
            return res.status(500).json({ error: 'Ошибка сохранения бота' });
        }

        console.log('✅ Бот создан:', name);

        res.json({
            success: true,
            bot: newBot,
            message: `Бот "${name}" создан успешно`,
            exchangeUsed: isConnected ? 'existing' : 'new'
        });

    } catch (err) {
        console.error('❌ Ошибка создания бота:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/public/market-overview', async (req, res) => {
    try {
        const [fgRes, priceRes, capRes, changeRes] = await Promise.all([
            axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 5000 }),
            axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd', { timeout: 5000 }),
            axios.get('https://api.coingecko.com/api/v3/global', { timeout: 5000 }),
            axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true', { timeout: 5000 })
        ]);

        const fearGreed = parseInt(fgRes.data.data[0].value) || 50;
        const btcPrice = priceRes.data.bitcoin?.usd || 0;
        const ethPrice = priceRes.data.ethereum?.usd || 0;
        const totalCap = capRes.data.data?.total_market_cap?.usd || 0;
        const btcDominance = capRes.data.data?.market_cap_percentage?.btc || 0;
        const btcChange24h = changeRes.data.bitcoin?.usd_24h_change || 0;
        const ethChange24h = changeRes.data.ethereum?.usd_24h_change || 0;

        res.json({
            fearGreed,
            btcPrice,
            ethPrice,
            totalCap,
            btcDominance,
            btcChange24h,
            ethChange24h
        });
    } catch (error) {
        console.error('❌ Ошибка рыночных индикаторов:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/public/top-coins', async (req, res) => {
    try {
        const resp = await axios.get(
            'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=true&price_change_percentage=24h',
            { timeout: 8000 }
        );
        res.json(resp.data);
    } catch (error) {
        console.error('❌ Ошибка топ-монет:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/public/technical-indicators', async (req, res) => {
    try {
        const resp = await axios.get(
            'https://api.coingecko.com/api/v3/coins/bitcoin/ohlc?vs_currency=usd&days=30',
            { timeout: 8000 }
        );
        
        const prices = resp.data.map(item => item[4]);
        const lastPrices = prices.slice(-20);

        function calcRSI(prices, period = 14) {
            if (prices.length < period + 1) return null;
            const deltas = [];
            for (let i = 1; i < prices.length; i++) {
                deltas.push(prices[i] - prices[i - 1]);
            }
            const gains = deltas.map(d => d > 0 ? d : 0);
            const losses = deltas.map(d => d < 0 ? -d : 0);
            const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
            const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
            if (avgLoss === 0) return 100;
            const rs = avgGain / avgLoss;
            return 100 - (100 / (1 + rs));
        }

        function calcMACD(prices, fast = 12, slow = 26, signal = 9) {
            if (prices.length < slow + signal) return null;
            const emaFast = prices.slice(-fast).reduce((a, b) => a + b, 0) / fast;
            const emaSlow = prices.slice(-slow).reduce((a, b) => a + b, 0) / slow;
            const macdLine = emaFast - emaSlow;
            const signalLine = prices.slice(-signal).reduce((a, b) => a + b, 0) / signal;
            return {
                macd: macdLine,
                signal: signalLine,
                histogram: macdLine - signalLine
            };
        }

        function calcBollinger(prices, period = 20, stdDev = 2) {
            if (prices.length < period) return null;
            const slice = prices.slice(-period);
            const mean = slice.reduce((a, b) => a + b, 0) / period;
            const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
            const std = Math.sqrt(variance);
            return {
                upper: mean + stdDev * std,
                middle: mean,
                lower: mean - stdDev * std,
                bandwidth: (2 * stdDev * std / mean) * 100
            };
        }

        const rsi = calcRSI(prices);
        const macd = calcMACD(prices);
        const bollinger = calcBollinger(prices);
        const volatility = (Math.max(...lastPrices) - Math.min(...lastPrices)) / lastPrices.reduce((a, b) => a + b, 0) * 100;

        res.json({
            rsi: rsi !== null ? parseFloat(rsi.toFixed(1)) : null,
            macd_histogram: macd !== null ? parseFloat(macd.histogram.toFixed(6)) : null,
            bollinger_band: bollinger !== null ? parseFloat(bollinger.bandwidth.toFixed(2)) : null,
            volatility: parseFloat(volatility.toFixed(2))
        });
    } catch (error) {
        console.error('❌ Ошибка технических индикаторов:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/public/trending', async (req, res) => {
    try {
        const resp = await axios.get(
            'https://api.coingecko.com/api/v3/search/trending',
            { timeout: 5000 }
        );
        res.json({ coins: resp.data.coins || [] });
    } catch (error) {
        console.error('❌ Ошибка трендовых монет:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/public/news', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        
        try {
            const resp = await axios.get(
                `https://cryptocurrency.cv/api/news?limit=${limit}&language=en`,
                { timeout: 5000 }
            );
            if (resp.data && resp.data.length > 0) {
                return res.json({ 
                    news: resp.data.map(item => ({
                        title: item.title,
                        url: item.url,
                        source: item.source || 'Crypto',
                        published_at: item.published_at || new Date().toISOString()
                    }))
                });
            }
        } catch (e) {
            console.log('cryptocurrency.cv недоступен, пробуем RSS');
        }

        const rssResp = await axios.get(
            'https://cointelegraph.com/rss',
            { timeout: 5000 }
        );
        
        const items = rssResp.data.match(/<item>[\s\S]*?<\/item>/g) || [];
        const news = items.slice(0, limit).map(item => {
            const title = item.match(/<title>(.*?)<\/title>/)?.[1] || '';
            const link = item.match(/<link>(.*?)<\/link>/)?.[1] || '';
            const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
            return {
                title: title.replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
                url: link,
                source: 'CoinTelegraph',
                published_at: new Date(pubDate).toISOString()
            };
        });

        res.json({ news });
    } catch (error) {
        console.error('❌ Ошибка новостей:', error.message);
        res.status(500).json({ error: error.message });
    }
});

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
                }
            }
        }

    } catch (error) {
        console.error('❌ Ошибка анализа рынка:', error.message);
    }
}, {
    timezone: "Europe/Moscow"
});

console.log('⏰ Планировщик запущен (каждую минуту)');