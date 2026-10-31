// netlify/edge-functions/proxy-handler.ts
import type { Context } from "@netlify/edge-functions";

export default async (request: Request, context: Context) => {
  // 1. 处理跨域预检请求 (OPTIONS)
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Range, Accept, Origin",
      }
    });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  // 2. 专门处理 /proxy/ 路径
  if (path.startsWith('/proxy/')) {
    try {
      let targetUrlString = path.substring('/proxy/'.length);
      
      if (targetUrlString.startsWith('http%3A%2F%2F') || targetUrlString.startsWith('https%3A%2F%2F')) {
        targetUrlString = decodeURIComponent(targetUrlString);
      }
      if (!targetUrlString.startsWith('http://') && !targetUrlString.startsWith('https://')) {
        targetUrlString = 'https://' + targetUrlString;
      }
      
      const targetUrl = new URL(targetUrlString);
      
      // 注意：这里删除了原本的 ALLOWED_DOMAINS 白名单限制，允许代理任意 IPTV 源

      context.log(`Proxying request to: ${targetUrl.toString()}`);
      
      // 继承原始查询参数
      if (url.search && !targetUrlString.includes('?')) {
        targetUrl.search = url.search;
      }
      
      const proxyRequest = new Request(targetUrl.toString(), {
        method: request.method,
        headers: request.headers,
        redirect: 'follow', // 允许自动跟随重定向
      });
      
      // 设置请求头伪装
      proxyRequest.headers.set("Host", targetUrl.host);
      proxyRequest.headers.delete('accept-encoding'); // 避免压缩乱码
      proxyRequest.headers.set('Referer', `${targetUrl.protocol}//${targetUrl.host}/`);
      proxyRequest.headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
      
      const response = await fetch(proxyRequest);
      
      // === 核心修改点：强制设置响应头和跨域 ===
      const newHeaders = new Headers();
      
      // 复制原始响应头（除了一些会导致问题的头）
      for (const [key, value] of response.headers.entries()) {
        if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) {
          newHeaders.set(key, value);
        }
      }
      
      // 强制设置为跨域允许，解决飞牛前端无法拉取的问题
      newHeaders.set('Access-Control-Allow-Origin', '*');
      
      // 核心：如果是 m3u 或 m3u8 文件，强制指定 Content-Type，解决飞牛报错“无法连接”
      if (targetUrl.pathname.endsWith('.m3u') || targetUrl.pathname.endsWith('.m3u8') || path.includes('.m3u')) {
        newHeaders.set('Content-Type', 'application/vnd.apple.mpegurl');
      }
      // =========================================

      let newResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
      
      return newResponse;

    } catch (error) {
      context.log(`Error proxying URL: ${error}`);
      return new Response(`代理请求失败: ${error}`, { 
        status: 502,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain;charset=UTF-8' }
      });
    }
  }

  // 其他路径返回 404
  return new Response("Not Found", { status: 404 });
};
