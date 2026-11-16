# Foundation monitoring

Instala el paquete Debian prometheus-node-exporter, lo controla con systemd y
publica mÃ©tricas de host, servicios esperados y antigÃ¼edad de backup/check.
Escucha en 127.0.0.1:9100 por defecto. El collector textfile lee
/var/lib/prometheus/node-exporter; los escritores publican archivos atÃ³micamente.

La configuraciÃ³n no abre puertos, no agrega un destino Prometheus remoto ni
prueba entrega de alertas. La integraciÃ³n con el servidor de monitoreo requiere
decidir transporte y origen autorizado, y verificar scrape y alerta reales.

Variables: foundation_monitoring_enabled, foundation_monitoring_listen_address,
foundation_monitoring_textfile_directory, foundation_monitoring_health_interval,
foundation_monitoring_expected_services, foundation_monitoring_backup_state_directory,
foundation_monitoring_backup_max_age_seconds y
foundation_monitoring_backup_check_max_age_seconds. Ver defaults/main.yml.

VerificaciÃ³n local: curl --fail http://127.0.0.1:9100/metrics,
systemctl status prometheus-node-exporter redunisol-foundation-health.timer y
journalctl -u redunisol-foundation-health.service. El timer de salud no afirma
que exista un backup: timestamps ausentes se representan con age=-1 y stale=1.
foundation_backup_configured proviene del rol backups; debe alertarse si vale 0.
TambiÃ©n debe alertarse si el colector deja de ejecutarse, falta el scrape o el
archivo textfile queda viejo; node_textfile_mtime_seconds permite observar esto.

foundation_monitoring_enabled=false detiene y deshabilita exporter y timer;
los paquetes y la configuraciÃ³n permanecen instalados. Este paso acepta sÃ³lo 127.0.0.1:9100 o [::1]:9100. Una exposiciÃ³n externa
requiere un cambio separado con origen autorizado, transporte y firewall.

Check mode valida contratos de variables y omite instalaciones, archivos y servicios.
No simula un host vacÃ­o ni demuestra funcionamiento. La verificaciÃ³n posterior es
real y de solo lectura. El paquete se instala con policy_rc_d=101 para evitar un
arranque con el listener predeterminado antes de aplicar el drop-in de loopback.
