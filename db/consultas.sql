-- Consultas para ver la estadística (pegarlas una a una en la Console de la base D1).
-- "usuarios" = navegadores que abrieron la app ese día; "oyentes" = los que además escucharon algo.

-- Por día (últimos 30): usuarios, oyentes, horas totales y minutos por oyente
SELECT dia, app, COUNT(*) AS usuarios, SUM(seg > 0) AS oyentes,
       ROUND(SUM(seg) / 3600.0, 1) AS horas,
       ROUND(SUM(seg) / 60.0 / MAX(SUM(seg > 0), 1), 1) AS min_por_oyente
FROM uso GROUP BY dia, app ORDER BY dia DESC, app LIMIT 30;

-- Usuarios distintos en total, desde el principio
SELECT app, COUNT(DISTINCT id) AS usuarios, ROUND(SUM(seg) / 3600.0, 1) AS horas FROM uso GROUP BY app;

-- Usuarios distintos en los últimos 7 y 30 días
SELECT app,
       COUNT(DISTINCT CASE WHEN dia >= date('now', '-7 day') THEN id END) AS ultimos_7,
       COUNT(DISTINCT CASE WHEN dia >= date('now', '-30 day') THEN id END) AS ultimos_30
FROM uso GROUP BY app;

-- Usuarios nuevos por día (los que aparecen por primera vez)
SELECT primer_dia AS dia, app, COUNT(*) AS nuevos
FROM (SELECT app, id, MIN(dia) AS primer_dia FROM uso GROUP BY app, id)
GROUP BY primer_dia, app ORDER BY primer_dia DESC LIMIT 30;
