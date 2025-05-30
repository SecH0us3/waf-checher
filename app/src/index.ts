import { PAYLOADS, PayloadCategory } from './payloads';

// Вспомогательная функция для отправки запроса с нужным методом и payload
async function sendRequest(url: string, method: string, payload?: string, headersObj?: Record<string, string>, payloadTemplate?: string) {
  try {
    let resp: Response;
    const headers = headersObj ? new Headers(headersObj) : undefined;
    switch (method) {
      case "GET":
      case "DELETE":
        resp = await fetch(payload !== undefined ? url + `?test=${encodeURIComponent(payload)}` : url, { method, redirect: 'manual', headers });
        break;
      case "POST":
      case "PUT":
        if (payloadTemplate) {
          let jsonObj;
          try {
            jsonObj = JSON.parse(payloadTemplate);
            jsonObj = substitutePayload(jsonObj, payload ?? "");
          } catch {
            jsonObj = { test: payload ?? "" };
          }
          resp = await fetch(url, { method, redirect: 'manual', body: JSON.stringify(jsonObj), headers: new Headers({ ...(headersObj || {}), 'Content-Type': 'application/json' }) });
        } else {
          resp = await fetch(url, { method, redirect: 'manual', body: new URLSearchParams({ test: payload ?? "" }), headers });
        }
        break;
      default:
        return null;
    }

    console.log(`Request to ${url} with method ${method} and payload ${payload} and headers ${JSON.stringify(headersObj)} returned status ${resp.status}`);
    
    return {
      status: resp.status,
      is_redirect: resp.status >= 300 && resp.status < 400
    };
  } catch (e) {
    return { status: 'ERR', is_redirect: false };
  }
}

async function handleApiCheck(url: string, page: number, methods: string[]): Promise<any[]> {
  const METHODS = methods && methods.length ? methods : ["GET"];
  const results: any[] = [];
  let baseUrl: string;
  const limit = 50;
  const start = page * limit;
  const end = start + limit;
  let offset = 0;
  try {
    const u = new URL(url);
    baseUrl = `${u.protocol}//${u.host}`;
  } catch {
    baseUrl = url;
  }
  for (const [category, info] of Object.entries(PAYLOADS)) {
    const checkType = info.type || "ParamCheck";
    const payloads = info.payloads || [];
    if (checkType === "ParamCheck") {
      for (const payload of payloads) {
        for (const method of METHODS) {
          if (offset >= end) return results;
          if (offset >= start) {
            const res = await sendRequest(url, method, payload);
            results.push({
              category,
              payload,
              method,
              status: res ? res.status : 'ERR',
              is_redirect: res ? res.is_redirect : false
            });
          }
          offset++;
        }
      }
    } else if (checkType === "FileCheck") {
      for (const payload of payloads) {
        if (offset >= end) return results;
        if (offset >= start) {
          const fileUrl = baseUrl.replace(/\/$/, '') + '/' + payload.replace(/^\//, '');
          const res = await sendRequest(fileUrl, "GET");
          results.push({
            category,
            payload,
            method: 'GET',
            status: res ? res.status : 'ERR',
            is_redirect: res ? res.is_redirect : false
          });
        }
        offset++;
      }
    } else if (checkType === "Header") {
      for (const payload of payloads) {
        // payload может быть строкой вида 'Header-Name: value' или несколькими заголовками через \r\n
        const headersObj: Record<string, string> = {};
        for (const line of payload.split(/\r?\n/)) {
          const idx = line.indexOf(":");
          if (idx > 0) {
            const name = line.slice(0, idx).trim();
            const value = line.slice(idx + 1).trim();
            headersObj[name] = value;
          }
        }
        for (const method of METHODS) {
          if (offset >= end) return results;
          if (offset >= start) {
            const res = await sendRequest(url, method, undefined, headersObj);
            results.push({
              category,
              payload,
              method,
              status: res ? res.status : 'ERR',
              is_redirect: res ? res.is_redirect : false
            });
          }
          offset++;
        }
      }
    }
  }
  return results;
}

// Лучше сразу загрузить index.html при старте (если возможно)
let INDEX_HTML = "";

export default {
  async fetch(request: Request): Promise<Response> {
    const urlObj = new URL(request.url);
    if (urlObj.pathname === "/") {
      return new Response(INDEX_HTML, { headers: { "content-type": "text/html; charset=UTF-8" } });
    }
    if (urlObj.pathname === "/api/check") {
      const url = urlObj.searchParams.get("url");
      if (!url) return new Response("Missing url param", { status: 400 });
      if (url.includes('secmy')) {
        // Если параметр url содержит 'secmy', немедленно вернуть пустой массив
        return new Response(JSON.stringify([]), { headers: { "content-type": "application/json; charset=UTF-8" } });
      }
      const page = parseInt(urlObj.searchParams.get("page") || "0", 10);
      const methods = (urlObj.searchParams.get("methods") || "GET")
        .split(',').map(m => m.trim()).filter(Boolean);
      // Получить выбранные категории
      const categoriesParam = urlObj.searchParams.get("categories");
      let categories: string[] | undefined = undefined;
      if (categoriesParam) {
        categories = categoriesParam.split(',').map(c => c.trim()).filter(Boolean);
      }
      let payloadTemplate: string | undefined = undefined;
      if (request.method === 'POST') {
        try {
          const body: any = await request.json();
          if (body && typeof body.payloadTemplate === 'string') {
            payloadTemplate = body.payloadTemplate;
          }
        } catch {}
      }
      const results = await handleApiCheckFiltered(url, page, methods, categories, payloadTemplate);
      return new Response(JSON.stringify(results), { headers: { "content-type": "application/json; charset=UTF-8" } });
    }
    return new Response("Not found", { status: 404 });
  }
};

// Новая функция для фильтрации по категориям
async function handleApiCheckFiltered(url: string, page: number, methods: string[], categories?: string[], payloadTemplate?: string): Promise<any[]> {
  const METHODS = methods && methods.length ? methods : ["GET"];
  const results: any[] = [];
  let baseUrl: string;
  const limit = 50;
  const start = page * limit;
  const end = start + limit;
  let offset = 0;
  try {
    const u = new URL(url);
    baseUrl = `${u.protocol}//${u.host}`;
  } catch {
    baseUrl = url;
  }
  // Если категории не заданы, использовать все
  const payloadEntries = categories && categories.length
    ? Object.entries(PAYLOADS).filter(([cat]) => categories.includes(cat))
    : Object.entries(PAYLOADS);
  for (const [category, info] of payloadEntries) {
    const checkType = info.type || "ParamCheck";
    const payloads = info.payloads || [];
    if (checkType === "ParamCheck") {
      for (const payload of payloads) {
        for (const method of METHODS) {
          if (offset >= end) return results;
          if (offset >= start) {
            const res = await sendRequest(url, method, payload, undefined, payloadTemplate);
            results.push({
              category,
              payload,
              method,
              status: res ? res.status : 'ERR',
              is_redirect: res ? res.is_redirect : false
            });
          }
          offset++;
        }
      }
    } else if (checkType === "FileCheck") {
      for (const payload of payloads) {
        if (offset >= end) return results;
        if (offset >= start) {
          const fileUrl = baseUrl.replace(/\/$/, '') + '/' + payload.replace(/^\//, '');
          const res = await sendRequest(fileUrl, "GET");
          results.push({
            category,
            payload,
            method: 'GET',
            status: res ? res.status : 'ERR',
            is_redirect: res ? res.is_redirect : false
          });
        }
        offset++;
      }
    } else if (checkType === "Header") {
      for (const payload of payloads) {
        const headersObj: Record<string, string> = {};
        for (const line of payload.split(/\r?\n/)) {
          const idx = line.indexOf(":");
          if (idx > 0) {
            const name = line.slice(0, idx).trim();
            const value = line.slice(idx + 1).trim();
            headersObj[name] = value;
          }
        }
        for (const method of METHODS) {
          if (offset >= end) return results;
          if (offset >= start) {
            const res = await sendRequest(url, method, undefined, headersObj, payloadTemplate);
            results.push({
              category,
              payload,
              method,
              status: res ? res.status : 'ERR',
              is_redirect: res ? res.is_redirect : false
            });
          }
          offset++;
        }
      }
    }
  }
  return results;
}

// Рекурсивная функция для замены всех значений "{{$$}}" на payload
function substitutePayload(obj: any, payload: string): any {
  if (typeof obj === 'string') {
    return obj === '{{$$}}' ? payload : obj;
  } else if (Array.isArray(obj)) {
    return obj.map(item => substitutePayload(item, payload));
  } else if (typeof obj === 'object' && obj !== null) {
    const res: any = {};
    for (const [k, v] of Object.entries(obj)) {
      res[k] = substitutePayload(v, payload);
    }
    return res;
  }
  return obj;
}
