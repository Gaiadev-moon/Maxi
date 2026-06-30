# Maxi

Sistema web para gestionar un drugstore y un bar desde una sola pantalla.

## Funciones

- Stock simple para productos de drugstore y bar.
- Ventas rapidas con ticket imprimible.
- Menu del bar y pedidos por mesa.
- Cierre de mesa como venta.
- Reportes basicos por area y productos mas vendidos.
- Backup e importacion de datos en JSON.

La primera version guarda los datos en `localStorage`, ideal para probar el flujo local antes de conectar una base de datos.

## Desarrollo

```bash
npm install
npm run dev -- --filter=web
```

Tambien se puede ejecutar solo la app web:

```bash
cd apps/web
npm run dev
```

La app queda disponible en `http://localhost:3000`.

## Validacion

```bash
cd apps/web
npx next build
npx next typegen
npx tsc --noEmit
```
