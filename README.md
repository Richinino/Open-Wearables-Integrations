# Open Wearables – vlastná inštancia

Moja inštancia [Open Wearables](https://github.com/the-momentum/open-wearables): dáta zo Samsung Health (telefón a hodinky) bežia nonstop v cloude a Claude Desktop sa k nim dostane cez MCP.

| Časť | Kde | Stav |
|---|---|---|
| Backend (API, Postgres, Redis, Celery, admin portál) | Oracle Cloud Always Free VM, HTTPS cez Caddy na verejnej IP | [návod](infra/oracle/README.md) |
| MCP pre Claude Desktop | lokálne v Claude Desktop, volá API v cloude | [návod, krok 7](infra/oracle/README.md#7-claude-desktop-mcp) |
| Web so sumárom dát | Vercel (Next.js) | neskôr |
| Záloha mimo Oracle | – | neskôr |

Tajomstvá (API kľúče, heslá, `.env`) do tohto repa nepatria.
