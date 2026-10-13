# Web so súhrnom dát

Súkromný prehľad výsledkov programu `owi`: dnešok, posledné týždne, spánok a tréningy.
Next.js (App Router), texty po slovensky. Návrh je v
[`docs/superpowers/specs/2026-10-13-web-design.md`](../docs/superpowers/specs/2026-10-13-web-design.md).

## Spustenie lokálne

```bash
npm install
npm run dev -- -p 3100
```

Potom otvor <http://localhost:3100> a prihlás sa heslom zo `SITE_PASSWORD`.

## Nastavenie

Premenné patria do `.env.local` (lokálne) alebo do nastavení projektu na Verceli.
Súbor `.env.local` sa do gitu nedostane; vzor bez hodnôt je v `.env.example`.

| Premenná | Na čo slúži |
|---|---|
| `SITE_PASSWORD` | heslo na prihlásenie |
| `SESSION_SECRET` | kľúč, ktorým sa podpisuje prihlasovacia cookie; aspoň 32 náhodných znakov |
| `OWI_API_URL` | adresa služby `owi serve`, bez `/v1/days` |
| `OWI_API_TOKEN` | token k `owi serve` (jej `OWI_SERVE_TOKEN`) |

Bez `SITE_PASSWORD` alebo `SESSION_SECRET` sa prihlásiť nedá. Všetky štyri hodnoty číta len
server, do prehliadača sa nedostanú.

## Umelé dáta

Keď `OWI_API_URL` nie je nastavená a web nebeží v produkcii, zobrazí vymyslené dáta za
posledných 120 dní. Pre rovnaký deň sú vždy rovnaké a sú v nich aj okrajové prípady:
chýbajúce dni, dni bez krokov, noci bez spánku a rozbehnutý dnešok. V produkcii sa umelé dáta
nepoužijú nikdy; bez adresy alebo tokenu web oznámi, že dáta nie sú dostupné.

## Testy

```bash
npm test
```

Testy bežia len na vymyslených hodnotách a nevolajú žiadnu sieť.
