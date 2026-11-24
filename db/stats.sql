-- Estadística anónima (Neo y Proxy). Una fila por usuario y día; "usuario" = un navegador (identificador aleatorio, sin IP ni datos personales).
--
-- Para activarla (una vez):
--   1. Cloudflare > Workers y Pages > D1 > Crear base de datos (por ejemplo "radio_stats"; sirve una sola para Neo y Proxy).
--   2. En su pestaña Console, pegar este archivo y ejecutar.
--   3. En cada proyecto de Pages (radioneo y proxweb): Configuración > Enlaces (Bindings) > Añadir > Base de datos D1,
--      nombre de variable STATS, y esa base. Después, volver a desplegar.
-- Mientras no esté enlazada no se cuenta nada y la web funciona igual.
--
-- Base creada antes de la columna pwa (2026-11-24): ejecutar una vez en la Console
--   ALTER TABLE uso ADD COLUMN pwa INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS uso (
  dia TEXT NOT NULL,                 -- AAAA-MM-DD, hora de España
  app TEXT NOT NULL,                 -- 'rn' = Neo, 'rp' = Proxy
  id  TEXT NOT NULL,                 -- identificador aleatorio del navegador
  seg INTEGER NOT NULL DEFAULT 0,    -- segundos escuchados ese día
  pwa INTEGER NOT NULL DEFAULT 0,    -- 1 si ese día la usó instalada (PWA); 0 en el navegador
  PRIMARY KEY (dia, app, id)
) WITHOUT ROWID;
