#!/usr/bin/env bash
set -euo pipefail

# Certbot deploy hook: validate and gracefully reload the frontend only.
/opt/apache/bin/httpd -D SSL -t
systemctl reload httpd
