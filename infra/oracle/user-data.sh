#!/bin/bash
# Open Wearables na Oracle Cloud Always Free (Ubuntu 24.04, ARM / VM.Standard.A1.Flex).
#
# Do Oracle stačí vložiť krátky bootstrap.sh, ktorý tento skript stiahne.
# Alebo vlož celý obsah tohto súboru pri vytváraní VM do:
#   Create instance -> Advanced options -> Management -> Initialization script
#   -> Paste cloud-init script
#
# Predpoklad: Security List podsiete v Oracle povoľuje prichádzajúce TCP 80 a 443.
# Verejná adresa bude https://<IP-s-pomlčkami>.sslip.io (HTTPS certifikát vybaví Caddy).
# Skript beží raz, pri prvom štarte VM, a trvá asi 5-10 minút.
# Log: /var/log/open-wearables-setup.log, výsledné adresy: /opt/open-wearables/INFO.txt

# ================================ VYPLŇ ================================
# Prihlásenie do admin portálu Open Wearables
ADMIN_EMAIL='tvoj@email.sk'
# Aspoň 12 znakov, bez medzier a bez znaku '. Po prvom prihlásení ho v portáli zmeň.
ADMIN_PASSWORD='SEM-DAJ-SILNE-HESLO'
# =======================================================================

# Krátky bootstrap.sh odovzdá hodnoty cez premenné prostredia OW_*.
ADMIN_EMAIL="${OW_ADMIN_EMAIL:-$ADMIN_EMAIL}"
ADMIN_PASSWORD="${OW_ADMIN_PASSWORD:-$ADMIN_PASSWORD}"

OW_VERSION='0.9.0'
CADDY_VERSION='2.11'
OW_DIR='/opt/open-wearables'

set -euo pipefail
exec > >(tee -a /var/log/open-wearables-setup.log) 2>&1
echo "=== Open Wearables setup štart: $(date -Is) ==="

fail() {
  echo "CHYBA: $*"
  mkdir -p "$OW_DIR"
  echo "Setup zlyhal: $* (detaily v /var/log/open-wearables-setup.log)" > "$OW_DIR/INFO.txt"
  exit 1
}

[[ "$ADMIN_EMAIL" == *@* && "$ADMIN_EMAIL" != 'tvoj@email.sk' ]] || fail "ADMIN_EMAIL nie je vyplnený."
[[ "$ADMIN_PASSWORD" != 'SEM-DAJ-SILNE-HESLO' && ${#ADMIN_PASSWORD} -ge 12 ]] \
  || fail "ADMIN_PASSWORD musí mať aspoň 12 znakov."
[[ "$ADMIN_PASSWORD" != *"'"* && "$ADMIN_PASSWORD" != *" "* ]] \
  || fail "ADMIN_PASSWORD nesmie obsahovať medzeru ani znak '."

# --- Firewall na VM: Ubuntu image v Oracle púšťa len SSH. Povolíme 80 a 443.
# Ukladá sa ešte pred inštaláciou Dockeru, aby sa do súboru nedostali jeho pravidlá.
if command -v iptables >/dev/null; then
  # shellcheck disable=SC2054  # čiarky patria do --dports, nie sú oddeľovač poľa
  RULE=(INPUT -p tcp -m multiport --dports 80,443 -m conntrack --ctstate NEW -j ACCEPT)
  iptables -C "${RULE[@]}" 2>/dev/null || iptables -I "${RULE[@]}"
  if command -v netfilter-persistent >/dev/null; then netfilter-persistent save; fi
fi

# --- Swap 2 GB ako poistka pri malej RAM ---
if [[ -z "$(swapon --show --noheadings)" ]]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- Docker (s rotáciou logov, aby sa disk časom nezaplnil) ---
export DEBIAN_FRONTEND=noninteractive
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
# Pri prvom štarte môže apt držať unattended-upgrades. Všetky apt príkazy
# preto počkajú na zámok namiesto chyby.
echo 'DPkg::Lock::Timeout "600";' > /etc/apt/apt.conf.d/90-lock-timeout
apt-get update -y
apt-get install -y docker.io docker-compose-v2 jq openssl curl ca-certificates
systemctl enable --now docker
usermod -aG docker ubuntu || true

# --- Verejná adresa: IP z Oracle + bezplatné meno cez sslip.io ---
is_ipv4() { [[ "$1" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; }
PUBLIC_IP="$(curl -fsS --retry 5 https://checkip.amazonaws.com | tr -d '[:space:]' || true)"
is_ipv4 "$PUBLIC_IP" || PUBLIC_IP="$(curl -fsS --retry 5 https://ifconfig.me | tr -d '[:space:]' || true)"
is_ipv4 "$PUBLIC_IP" || fail "Nepodarilo sa zistiť verejnú IP adresu (má VM pridelenú verejnú IPv4?)."
API_HOST="${PUBLIC_IP//./-}.sslip.io"
ADMIN_HOST="admin.${API_HOST}"
echo "Verejná IP: $PUBLIC_IP, API: https://$API_HOST, admin: https://$ADMIN_HOST"

# --- Konfigurácia Open Wearables ---
mkdir -p "$OW_DIR/backups" && chmod 700 "$OW_DIR/backups"
cd "$OW_DIR"

# .env sa generuje len raz; tajomstvá sa vytvoria tu na VM a nikam neodchádzajú.
if [[ ! -f .env ]]; then
  umask 077
  cat > .env <<EOF
# Vygenerované $(date -Is) skriptom user-data.sh. Necommitovať.
OW_VERSION=${OW_VERSION}
CADDY_VERSION=${CADDY_VERSION}

ENVIRONMENT=production
SECRET_KEY='$(openssl rand -hex 48)'

DB_NAME=open-wearables
DB_USER=open-wearables
DB_PASSWORD='$(openssl rand -hex 24)'

ADMIN_EMAIL='${ADMIN_EMAIL}'
ADMIN_PASSWORD='${ADMIN_PASSWORD}'

# Verejné adresy (Caddy pre ne vybaví HTTPS certifikáty)
API_HOST=${API_HOST}
ADMIN_HOST=${ADMIN_HOST}
# API: mobilná appka, Claude Desktop MCP, web na Verceli
API_BASE_URL=https://${API_HOST}
# Adresa, ktorú volá prehliadač s admin portálom
VITE_API_URL=https://${API_HOST}
# Admin portál
FRONTEND_URL=https://${ADMIN_HOST}
CORS_ORIGINS=["https://${ADMIN_HOST}"]
# API beží za Caddy: veriť jeho X-Forwarded-* hlavičkám (správne https v odpovediach)
FORWARDED_ALLOW_IPS='*'

SENTRY_ENABLED=false
OUTGOING_WEBHOOKS_ENABLED=false
EOF
  umask 022
fi

cat > Caddyfile <<'EOF'
{
	email {$ACME_EMAIL}
	# HTTP/3 (UDP) nie je v Oracle otvorené, ostávame pri HTTP/1.1 a HTTP/2.
	servers {
		protocols h1 h2
	}
}

{$API_HOST} {
	reverse_proxy app:8000
}

{$ADMIN_HOST} {
	reverse_proxy frontend:3000
}
EOF

cat > docker-compose.yml <<'EOF'
# Produkčný stack Open Wearables pre jednu ARM VM.
# Von sú len porty 80 a 443 (Caddy, HTTPS). API a frontend sú na 127.0.0.1.
# Verziu meníš cez OW_VERSION v .env (pred upgradom si prečítaj release notes).
name: open-wearables

x-backend: &backend
  image: themomentum/open-wearables-backend:${OW_VERSION:?Set OW_VERSION in .env}
  env_file: .env
  environment:
    DB_HOST: db
    REDIS_HOST: redis
  restart: unless-stopped

services:
  caddy:
    image: caddy:${CADDY_VERSION:?Set CADDY_VERSION in .env}
    ports:
      - "80:80"
      - "443:443"
    environment:
      API_HOST: ${API_HOST:?Set API_HOST in .env}
      ADMIN_HOST: ${ADMIN_HOST:?Set ADMIN_HOST in .env}
      ACME_EMAIL: ${ADMIN_EMAIL:?Set ADMIN_EMAIL in .env}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    networks:
      default:
        # Kontajnery (napr. SSR admin portálu) dosiahnu verejnú adresu API priamo cez Caddy.
        aliases:
          - ${API_HOST}
    depends_on:
      - app
      - frontend
    restart: unless-stopped

  db:
    image: postgres:18
    environment:
      POSTGRES_DB: ${DB_NAME:?Set DB_NAME in .env}
      POSTGRES_USER: ${DB_USER:?Set DB_USER in .env}
      POSTGRES_PASSWORD: ${DB_PASSWORD:?Set DB_PASSWORD in .env}
    volumes:
      - postgres_data:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped

  redis:
    image: redis:8
    command: ["redis-server", "--appendonly", "yes", "--appendfsync", "everysec"]
    volumes:
      - redis_data:/data
    restart: unless-stopped

  app:
    <<: *backend
    # Pri každom štarte aplikuje migrácie DB a seed skripty, potom spustí API.
    command: scripts/start/app.sh
    ports:
      - "127.0.0.1:8000:8000"
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/openapi.json', timeout=5)"]
      interval: 15s
      timeout: 10s
      retries: 5
      start_period: 300s

  # Worker a beat štartujú až po dobehnutí migrácií (app je healthy).
  celery-worker:
    <<: *backend
    command: scripts/start/worker.sh
    depends_on:
      app:
        condition: service_healthy

  celery-beat:
    <<: *backend
    command: scripts/start/beat.sh
    depends_on:
      app:
        condition: service_healthy

  frontend:
    image: themomentum/open-wearables-frontend:${OW_VERSION:?Set OW_VERSION in .env}
    environment:
      VITE_API_URL: ${VITE_API_URL:?Set VITE_API_URL in .env}
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      - app
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
  caddy_data:
  caddy_config:
EOF

cat > backup.sh <<'EOF'
#!/bin/bash
# Denná záloha Postgresu na disk VM. Necháva posledných 14 dní.
# Chráni pred chybným upgradom, nie pred stratou VM (externá záloha je ďalší krok).
set -euo pipefail
cd /opt/open-wearables
out="backups/ow-$(date +%F).dump"
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$out.tmp"
[[ -s "$out.tmp" ]] || { echo "$(date -Is) záloha je prázdna"; rm -f "$out.tmp"; exit 1; }
mv "$out.tmp" "$out"
chmod 600 "$out"
find backups -name 'ow-*.dump' -mtime +14 -delete
echo "$(date -Is) OK $out ($(du -h "$out" | cut -f1))"
EOF
chmod 700 backup.sh
cat > /etc/cron.d/open-wearables-backup <<'EOF'
30 3 * * * root /opt/open-wearables/backup.sh >> /var/log/open-wearables-backup.log 2>&1
EOF

# --- Štart stacku ---
docker compose pull
docker compose up -d

echo "Čakám, kým API dobehne migrácie..."
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null http://127.0.0.1:8000/openapi.json; then break; fi
  sleep 10
done
curl -fsS -o /dev/null http://127.0.0.1:8000/openapi.json \
  || fail "API neodpovedá ani po 10 minútach. Pozri: cd $OW_DIR && docker compose logs app"

# HTTPS overujeme lokálne cez Caddy (--resolve), bez spoliehania sa na hairpin cez verejnú IP.
echo "Čakám na HTTPS certifikát..."
HTTPS_OK=no
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null --resolve "${API_HOST}:443:127.0.0.1" "https://${API_HOST}/openapi.json"; then
    HTTPS_OK=yes
    break
  fi
  sleep 10
done

if [[ "$HTTPS_OK" == yes ]]; then
  HTTPS_NOTE="HTTPS certifikát je vydaný."
else
  HTTPS_NOTE="HTTPS certifikát sa zatiaľ nepodarilo získať. Over v Oracle, že Security List podsiete
povoľuje TCP 80 a 443 zo zdroja 0.0.0.0/0. Caddy to skúša znova sám; zrýchliť sa to dá
reštartom VM v Oracle konzole. Detaily: cd ${OW_DIR} && sudo docker compose logs caddy"
fi

cat > INFO.txt <<EOF
Open Wearables ${OW_VERSION} beží.

API (mobilná appka, Claude Desktop MCP): https://${API_HOST}
API dokumentácia:                        https://${API_HOST}/docs
Admin portál:                            https://${ADMIN_HOST}
Prihlásenie:                             ${ADMIN_EMAIL} (heslo z user-data, po prihlásení ho zmeň)

${HTTPS_NOTE}

Príkazy (cez SSH na VM):
  cd ${OW_DIR} && sudo docker compose ps
  cd ${OW_DIR} && sudo docker compose logs -f app
  cd ${OW_DIR} && sudo docker compose logs caddy
  sudo ${OW_DIR}/backup.sh
EOF

echo "=== Hotovo: $(date -Is) ==="
cat INFO.txt
