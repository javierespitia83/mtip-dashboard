# MTIP Dashboard

Dashboard estático de seguimiento de la Fase 1 de MTIP (Municipal Tax Intelligence Platform).
Sin proceso de build: HTML + JS + CSS + dos JSON en `dashboard_data/`.

Local: `python3 -m http.server` en esta carpeta y abrir http://localhost:8000/
Los JSON se generan desde el proyecto principal con `scripts/export_dashboard_data.py`.

Publicar: desde el proyecto principal, `./scripts/publish_dashboard.sh` (regenera los JSON, commit y push; Cloudflare Pages redespliega).
El repo es de la cuenta `javierespitia83`: `.git/config` de esta carpeta fija ese usuario en la URL del remoto y un `credential.helper` que pide a `gh` su token en cada push, aunque la cuenta activa sea otra.

Pestaña "Esta semana": cambios de Mi Colombia Digital y SharePoint con clase (incluye "Norma tributaria (posible E4)"), tipo de cambio (nuevo, nuevo de norma antigua, modificado, primera vista, retirado), duplicados y resultado de la verificación del archivo. El indicador "Por revisar" cuenta solo los cambios tributarios que piden lectura.

