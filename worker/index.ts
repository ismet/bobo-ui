interface Env {
  ASSETS: { fetch: (request: Request | string | URL) => Promise<Response> };
}

// Workers subrequests cannot use bare-IP URLs (documented platform limitation:
// https://developers.cloudflare.com/workers/platform/known-issues/#fetch-to-ip-addresses).
// sslip.io resolves "<a>.<b>.<c>.<d>.sslip.io" to that IP via DNS, so we use a
// hostname instead of an IP literal in the outbound URL.
const BACKEND_HOST = '45.146.4.98.sslip.io:8282';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api')) {
      const target = new URL(request.url);
      target.protocol = 'http:';
      target.host = BACKEND_HOST;
      target.pathname = url.pathname.replace(/^\/api/, '') || '/';
      const backendReq = new Request(target, request);
      return fetch(backendReq);
    }
    return env.ASSETS.fetch(request);
  },
};