async _signedRequest(method, endpoint, params = {}) {
    const timestamp = Date.now().toString();
    const allParams = { ...params, timestamp };
    
    // Формируем строку параметров для подписи
    let parameters = '';
    for (const key in allParams) {
        parameters += `${key}=${allParams[key]}&`;
    }
    parameters = parameters.slice(0, -1);
    
    // Генерируем подпись
    const signature = crypto
        .createHmac('sha256', this.secretKey)
        .update(parameters)
        .digest('hex');
    
    // Формируем URL с параметрами
    const queryParams = { ...allParams, signature };
    const queryString = Object.keys(queryParams)
        .map(key => `${key}=${encodeURIComponent(queryParams[key])}`)
        .join('&');
    
    const url = `${this.baseURL}${endpoint}?${queryString}`;
    
    const config = {
        method: method,
        url: url,
        headers: {
            'X-BX-APIKEY': this.apiKey,
            'Content-Type': 'application/json'
        }
    };
    
    const response = await axios(config);
    return response.data;
}