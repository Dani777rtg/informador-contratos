# WhatsApp: plantilla de mensaje

Variables de entorno (cárguelas desde `.env`; nunca se imprimen): `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_API_VERSION`, `WHATSAPP_BUSINESS_ACCOUNT_ID`.

Script npm que T001/integración deben apuntar a `scripts/whatsapp-template.ts` (p. ej. con `tsx`):

```
"wa:template": "tsx scripts/whatsapp-template.ts"
```

- `npm run wa:template`: crea la plantilla si no existe y consulta su estado hasta APPROVED.
- `npm run wa:template -- --status`: solo consulta el estado.

Plantilla `resumen_secop`: categoría UTILITY, idioma `es`, variables posicionales `{{1}}` (resumen) y `{{2}}` (enlace SECOP) con ejemplo; el texto no empieza ni termina con variable ni es promocional. Si Meta la rechaza, el script la reenvía con un nombre nuevo (`resumen_secop_vN_...`, hasta 3 intentos); el nombre final se registra en la salida y debe configurarse como nombre de plantilla del servidor. Código de salida: 0 si APPROVED, 2 si queda en otro estado.

La creación real la ejecuta el dueño; las pruebas usan `fetch` simulado.
