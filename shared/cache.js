// ============================================
//  МОДУЛЬ КЕШИРОВАНИЯ (Cache)
// ============================================

class Cache {
    constructor() {
        this.store = new Map();
        this.defaultTTL = 60000; // 60 секунд по умолчанию
    }

    /**
     * Установить значение в кеш
     * @param {string} key - Ключ
     * @param {any} value - Значение
     * @param {number} ttl - Время жизни в миллисекундах
     */
    set(key, value, ttl = this.defaultTTL) {
        const expiresAt = Date.now() + ttl;
        this.store.set(key, { value, expiresAt });
        return true;
    }

    /**
     * Получить значение из кеша
     * @param {string} key - Ключ
     * @returns {any|null} - Значение или null, если ключ не найден или истёк
     */
    get(key) {
        const entry = this.store.get(key);
        if (!entry) return null;

        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return null;
        }

        return entry.value;
    }

    /**
     * Проверить, существует ли ключ в кеше (и не истёк ли он)
     */
    has(key) {
        const entry = this.store.get(key);
        if (!entry) return false;

        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return false;
        }

        return true;
    }

    /**
     * Удалить ключ из кеша
     */
    delete(key) {
        return this.store.delete(key);
    }

    /**
     * Очистить весь кеш
     */
    clear() {
        this.store.clear();
    }

    /**
     * Получить все ключи в кеше
     */
    keys() {
        return Array.from(this.store.keys());
    }

    /**
     * Получить количество записей в кеше
     */
    size() {
        return this.store.size;
    }

    /**
     * Применить функцию к каждому элементу в кеше
     */
    forEach(callback) {
        for (const [key, entry] of this.store) {
            if (Date.now() <= entry.expiresAt) {
                callback(key, entry.value);
            }
        }
    }
}

module.exports = new Cache();