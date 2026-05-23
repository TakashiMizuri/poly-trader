#!/usr/bin/env bash
# One-time VPS bootstrap for Ubuntu 24.04 (run as root or with sudo).
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/setup-server.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl git ufw fail2ban

# Docker Engine + Compose plugin (official repo)
install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "${VERSION_CODENAME:-$VERSION}") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

systemctl enable --now docker

# Host nginx + Certbot (HTTPS termination in front of Docker web on 127.0.0.1:8080)
apt-get install -y nginx certbot python3-certbot-nginx

# Firewall: SSH + HTTP/S only
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# App directory
mkdir -p /opt/poly-trader
chown -R "${SUDO_USER:-root}:${SUDO_USER:-root}" /opt/poly-trader 2>/dev/null || true

echo ""
echo "Server ready. Next steps:"
echo "  1. Clone or upload the project to /opt/poly-trader"
echo "  2. cp .env.example .env && nano .env"
echo "  3. bash deploy/update.sh"
echo "  4. Configure nginx: see DEPLOY.ru.md"
