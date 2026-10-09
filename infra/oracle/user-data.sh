#!/bin/bash
# Open Wearables na Oracle Cloud Always Free (Ubuntu 24.04, ARM / VM.Standard.A1.Flex).
#
# Jednoduchšie: do Oracle vlož krátky bootstrap.sh, ktorý tento skript stiahne.
# Alebo vlož celý obsah tohto súboru pri vytváraní VM do:
#   Create instance -> Show advanced options -> Management -> Initialization script
#   -> Paste cloud-init script
#
# Vyplň len tri hodnoty v bloku VYPLŇ. Hodnoty nechaj v jednoduchých úvodzovkách.
# Skript beží raz, pri prvom štarte VM, a trvá asi 5-10 minút.
# Log: /var/log/open-wearables-setup.log, výsledné adresy: /opt/open-wearables/INFO.txt

# ================================ VYPLŇ ================================
# Tailscale -> Settings -> Keys -> Generate auth key (Reusable: vypnuté, Expiration: 1 day)
TS_AUTHKEY='tskey-auth-SEM-VLOZ-KLUC'
# Prihlásenie do admin portálu Open Wearables
ADMIN_EMAIL='tvoj@email.sk'
# Aspoň 12 znakov, bez medzier a bez znaku '. Po prvom prihlásení ho v portáli zmeň.
ADMIN_PASSWORD='SEM-DAJ-SILNE-HESLO'
# =======================================================================

# Krátky bootstrap.sh odovzdá hodnoty cez premenné prostredia OW_*.
TS_AUTHKEY="${OW_TS_AUTHKEY:-$TS_AUTHKEY}"
ADMIN_EMAIL="${OW_ADMIN_EMAIL:-$ADMIN_EMAIL}"
ADMIN_PASSWORD="${OW_ADMIN_PASSWORD:-$ADMIN_PASSWORD}"

OW_VERSION='0.9.0'
TS_HOSTNAME='ow'
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

case "$TS_AUTHKEY" in
  tskey-auth-SEM-VLOZ-KLUC|"") fail "TS_AUTHKEY nie je vyplnený." ;;
  tskey-*) ;;
  *) fail "TS_AUTHKEY musí začínať 'tskey-'." ;;
esac
[[ "$ADMIN_EMAIL" == *@* && "$ADMIN_EMAIL" != 'tvoj@email.sk' ]] || fail "ADMIN_EMAIL nie je vyplnený."
[[ "$ADMIN_PASSWORD" != 'SEM-DAJ-SILNE-HESLO' && ${#ADMIN_PASSWORD} -ge 12 ]] \
  || fail "ADMIN_PASSWORD musí mať aspoň 12 znakov."
[[ "$ADMIN_PASSWORD" != *"'"* && "$ADMIN_PASSWORD" != *" "* ]] \
  || fail "ADMIN_PASSWORD nesmie obsahovať medzeru ani znak '."

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
# (aj inštalátor Tailscale) preto počkajú na zámok namiesto chyby.
echo 'DPkg::Lock::Timeout "600";' > /etc/apt/apt.conf.d/90-lock-timeout
apt-get update -y
apt-get install -y docker.io docker-compose-v2 jq openssl curl ca-certificates
systemctl enable --now docker
usermod -aG docker ubuntu || true

# --- Tailscale: verejná HTTPS adresa bez domény a bez otvárania portov ---
curl -fsSL https://tailscale.com/install.sh | sh
timeout 120 tailscale up --authkey="$TS_AUTHKEY" --hostname="$TS_HOSTNAME" --ssh \
  || fail "tailscale up zlyhal (neplatný alebo expirovaný auth key?)."

TS_DNS="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
[[ -n "$TS_DNS" && "$TS_DNS" != "null" ]] || fail "Nepodarilo sa zistiť Tailscale DNS meno (je zapnuté MagicDNS?)."
API_URL="https://${TS_DNS}"
ADMIN_URL="https://${TS_DNS}:8443"
echo "Tailscale DNS meno: $TS_DNS"

# --- Konfigurácia Open Wearables ---
mkdir -p "$OW_DIR/backups" && chmod 700 "$OW_DIR/backups"
cd "$OW_DIR"

# .env sa generuje len raz; tajomstvá sa vytvoria tu na VM a nikam neodchádzajú.
if [[ ! -f .env ]]; then
  umask 077
  cat > .env <<EOF
# Vygenerované $(date -Is) skriptom user-data.sh. Necommitovať.
OW_VERSION=${OW_VERSION}

ENVIRONMENT=production
SECRET_KEY='$(openssl rand -hex 48)'

DB_NAME=open-wearables
DB_USER=open-wearables
DB_PASSWORD='$(openssl rand -hex 24)'

ADMIN_EMAIL='${ADMIN_EMAIL}'
ADMIN_PASSWORD='${ADMIN_PASSWORD}'

# Verejná adresa API (mobilná appka, MCP, web na Verceli)
API_BASE_URL=${API_URL}
# Adresa, ktorú volá prehliadač s admin portálom
VITE_API_URL=${API_URL}
# Admin portál
FRONTEND_URL=${ADMIN_URL}
CORS_ORIGINS=["${ADMIN_URL}"]

SENTRY_ENABLED=false
OUTGOING_WEBHOOKS_ENABLED=false
EOF
  umask 022
fi

cat > docker-compose.yml <<'EOF'
# Produkčný stack Open Wearables pre jednu ARM VM.
# Porty sú len na 127.0.0.1, von ich publikuje Tailscale Funnel.
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

# --- Verejné HTTPS adresy cez Tailscale Funnel (konfigurácia prežije reštart) ---
FUNNEL_OK=yes
timeout 60 tailscale funnel --bg 8000 || FUNNEL_OK=no
timeout 60 tailscale funnel --bg --https=8443 3000 || FUNNEL_OK=no

if [[ "$FUNNEL_OK" == yes ]]; then
  FUNNEL_NOTE="Funnel je zapnutý."
else
  FUNNEL_NOTE="Funnel sa nepodarilo zapnúť. V Tailscale admin konzole zapni HTTPS a Funnel, potom na VM spusti:
  sudo tailscale funnel --bg 8000
  sudo tailscale funnel --bg --https=8443 3000"
fi

cat > INFO.txt <<EOF
Open Wearables ${OW_VERSION} beží.

API (mobilná appka, Claude Desktop MCP): ${API_URL}
API dokumentácia:                        ${API_URL}/docs
Admin portál:                            ${ADMIN_URL}
Prihlásenie:                             ${ADMIN_EMAIL} (heslo z user-data, po prihlásení ho zmeň)

${FUNNEL_NOTE}

Príkazy (cez SSH na VM):
  cd ${OW_DIR} && sudo docker compose ps
  cd ${OW_DIR} && sudo docker compose logs -f app
  sudo tailscale funnel status
  sudo ${OW_DIR}/backup.sh
EOF

echo "=== Hotovo: $(date -Is) ==="
cat INFO.txt
