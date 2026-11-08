// Proxy gratuito per Cloudflare Workers: scarica i file del Comune e li restituisce con CORS aperto.
export default {
  async fetch(req) {
    const u = new URL(req.url).searchParams.get("url");
    if (!u || !u.startsWith("https://dati.venezia.it/sites/default/files/dataset/opendata/"))
      return new Response("Indirizzo non consentito", { status: 400 });
    const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile", "Accept": "application/json" } });
    return new Response(r.body, { status: r.status, headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60" } });
  }
};
