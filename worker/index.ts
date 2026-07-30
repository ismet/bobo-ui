interface Env {
  ASSETS: { fetch: (request: Request | string | URL) => Promise<Response> };
}

const BACKEND_HOST = '185.114.48.111:8282';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api')) {
      const target = new URL(request.url);
      target.protocol = 'http:';
      target.host = BACKEND_HOST;
      target.pathname = url.pathname.replace(/^\/api/, '') || '/';
      const headers = new Headers(request.headers);
      headers.set('Host', BACKEND_HOST);
      headers.delete('Origin');
      headers.delete('Referer');
      const backendReq = new Request(target, { method: request.method, headers, body: request.body });
      return fetch(backendReq);
    }
    return env.ASSETS.fetch(request);
  },
};