# BrasaGest — Sistema de pollería

Proyecto académico en React + TypeScript + Firebase. Incluye diseño responsive, Firebase Authentication, perfiles en **Firebase Realtime Database**, navegación por rol, mesas y productos, pedidos en sala, cocina, caja y reportes de ventas.

## Flujo de atención

1. **Pedidos en sala (mozo o administrador):** seleccionar una mesa libre, elegir productos y cantidades, añadir indicaciones y enviar a cocina. Solo se permiten mesas habilitadas y productos disponibles. Cada mesa admite un pedido abierto; el pedido y su ocupación se registran en una sola escritura atómica.
2. **Pantalla de cocina (cocina o administrador):** avanzar de Pendiente a En preparación y luego a Listo para servir. El tablero se actualiza en tiempo real y muestra cantidades, indicaciones y minutos desde la creación.
3. **Pedidos en sala:** marcar el pedido listo como Entregado.
4. **Caja y pagos (cajero o administrador):** revisar/imprimir la precuenta, seleccionar el método y registrar un pago recibido. Efectivo calcula el vuelto; Yape, Plin y tarjeta requieren una referencia y el monto exacto. El registro es manual, sin conexión con bancos ni procesamiento automático de pagos. Solo se cobran pedidos entregados. El pago y la liberación de la mesa se confirman juntos; un pedido pagado no se puede cobrar de nuevo ni borrar desde la aplicación.
5. **Reportes (administrador):** consultar ventas cobradas por fecha, método y producto, detalle de operaciones y cancelaciones; exportar CSV. Los cortes de día usan America/Lima y la fecha del pago. El panel general muestra ingresos cobrados y pedidos del día.

El mozo puede cancelar su pedido mientras está pendiente. El administrador puede cancelar cualquier pedido abierto. Toda cancelación requiere un motivo y libera la mesa, conservando el historial.

### Alcance y estructura

- `pedidos/{id}` conserva líneas con nombre y precio al momento de enviar, cantidades, total, creador, fechas, estado y datos de pago o cancelación. Los cambios posteriores de la carta no alteran pedidos anteriores.
- `ocupacion/{mesaId}` apunta al pedido abierto. Las reglas validan ambos lados de cada alta o cierre y evitan que dos dispositivos ocupen una mesa a la vez. No se puede eliminar/deshabilitar una mesa con pedido abierto.
- Hasta 20 productos diferentes, 99 unidades por línea y S/ 100 000 por pedido. Los precios y totales usan céntimos enteros; el servidor comprueba cada subtotal y la suma completa.
- Los productos, cantidades e indicaciones no se editan después de enviar a cocina. Esta versión no incluye ampliaciones de comanda, división de cuentas, pagos parciales, devoluciones, inventario ni facturación tributaria.
- Los pagos y cancelaciones quedan inmutables. El historial se escucha completo, adecuado para esta etapa; antes de manejar grandes volúmenes conviene incorporar paginación y archivo.

## Mesas y productos

Disponible para administradores activos desde el menú **Mesas y productos** o el botón del panel general. Los cambios se sincronizan en tiempo real.

- **Mesas:** crear un número único entre 1 y 999, editar la capacidad (1–30 personas), habilitar/deshabilitar y eliminar con confirmación. El número identifica la mesa y no se edita. Una transacción evita sobrescribir una mesa si dos administradores intentan crear el mismo número.
- **Productos:** crear, editar y eliminar; registrar nombre, categoría, precio en soles, descripción opcional y disponibilidad. Búsqueda por nombre/descripción y filtro por categoría. Se aceptan coma o punto decimal y hasta dos decimales.
- Se muestran estados de carga, listas vacías, errores y confirmaciones de guardado. Sin conexión no se inician nuevas escrituras; una operación en curso espera la reconexión.
- Las rutas son `mesas/{numero}` y `productos/{id}`. Los precios se guardan como enteros en `precioCentimos` (S/ 18.50 = 1850), con un máximo de S/ 100 000. La ocupación se determina mediante los pedidos abiertos; no se incluye stock.

## Requisitos

- Node.js compatible con Vite (20.19+ o 22.12+).
- Un proyecto Firebase con una aplicación web registrada.

## Instalación

1. Ejecutar `npm install`.
2. Crear `.env` copiando `.env.example` si aún no existe y completar los datos de la aplicación web desde Firebase Console > Project settings > Your apps.
3. En Build > Authentication > Sign-in method, habilitar **Email/Password**.
4. En Build > **Realtime Database**, crear una base de datos en modo bloqueado. Copiar su URL exacta a `VITE_FIREBASE_DATABASE_URL` en `.env`. La URL depende de la región; no usar la URL de Firebase Console.
5. En Realtime Database > Rules, pegar el contenido de `database.rules.json` y publicar.
6. En Authentication > Users, crear un usuario mediante **Add user** y copiar su UID.
7. En Realtime Database > Data, crear `usuarios` y dentro un nodo cuya clave sea ese UID exacto. Agregar los campos del ejemplo siguiente. `activo` debe ser un booleano, no el texto `"true"`.
8. Ejecutar `npm run dev` e iniciar sesión con el correo y la contraseña del usuario creado. Reiniciar Vite después de modificar `.env`.

Ejemplo de estructura (reemplazar `UID_DE_AUTHENTICATION` por el UID real):

```json
{
  "usuarios": {
    "UID_DE_AUTHENTICATION": {
      "nombre": "Administrador",
      "correo": "admin@polleria.com",
      "rol": "administrador",
      "activo": true
    }
  }
}
```

Los roles admitidos son `administrador`, `mozo`, `cocina` y `cajero`. Si ya hay datos, agregar únicamente el nodo del usuario; importar este ejemplo en la raíz puede reemplazar datos existentes.

La aplicación escucha `usuarios/{uid}` con `onValue`: los cambios de nombre, rol o estado se reflejan sin recargar. Un perfil eliminado, inactivo o con un rol inválido bloquea el acceso al panel. La suscripción se cancela al cambiar de usuario o cerrar sesión.

## Cambio desde Firestore

Los perfiles existentes en Firestore no se transfieren automáticamente: hay que copiarlos a `usuarios/{uid}` en Realtime Database conservando el UID de Authentication. Las cuentas y contraseñas de Authentication siguen siendo las mismas. Si se conserva `creadoEn`, puede representarse como una marca de tiempo numérica en milisegundos; la aplicación no requiere este campo.

## Seguridad

- No subir `.env` al repositorio.
- Cada usuario autenticado puede leer su propio perfil. Un administrador activo también puede leer el perfil de otro usuario mediante su UID.
- Se deniegan todas las escrituras de perfiles desde clientes, incluida la modificación de roles. Los perfiles se administran desde Firebase Console.
- El personal activo con rol válido puede consultar el catálogo, pedidos y ocupación. Solo un administrador puede modificar mesas y productos. Los demás roles solo ejecutan las transiciones que les corresponden.
- Las reglas validan tipos, límites, precios vigentes, totales, autor, fechas del servidor, transiciones, importes y vuelto; también impiden modificar el historial o introducir campos extra. Las rutas ajenas al sistema siguen bloqueadas.
- Las reglas no permiten listar todo `/usuarios`; el acceso se evalúa por UID.
- La interfaz por rol no sustituye las reglas del servidor. Cambiar el rol o desactivar un perfil revoca las operaciones que ya no le corresponden.

Las reglas operativas se generan con `npm run rules:build` desde `scripts/build-order-rules.mjs`, conservando los esquemas de perfiles y catálogo. Los 20 espacios de líneas permiten verificar sumas e inmutabilidad en las reglas de Realtime Database sin confiar en el total enviado por el cliente. Después de cambiar ese generador, regenerar `database.rules.json`, ejecutar las pruebas y publicar las reglas.

También se pueden publicar las reglas con Firebase CLI, después de iniciar sesión y verificar el proyecto destino:

```sh
npx firebase-tools login
npx firebase-tools deploy --only database --project TU_PROJECT_ID
```

## Verificación

```sh
npm run build
```

Pruebas de cálculo y reportes:

```sh
npm test
```

Para probar permisos, catálogo, ocupación simultánea, cocina, cobros, cancelaciones y protección del historial en una base local aislada (requiere Java y descargar Firebase CLI la primera vez):

```sh
npm run test:database
```

Estas pruebas usan exclusivamente el emulador en `127.0.0.1:9000` y el proyecto de demostración; no escriben en la base real.

### Recorrido manual

Con una mesa habilitada y un producto disponible, crear un pedido en Sala, iniciarlo y marcarlo listo en Cocina, marcarlo entregado en Sala y registrar el pago en Caja. Confirmar que la mesa vuelve a estar libre, que el registro de pago muestra el vuelto correcto y que Reportes incluye la venta del día. Un administrador puede recorrer todos los módulos con la misma sesión; para probar la separación por rol, crear cuentas de prueba y sus respectivos perfiles desde Firebase Console.

## Si no puedes ingresar

- **Configuración pendiente:** comprobar `.env`, especialmente `VITE_FIREBASE_DATABASE_URL`, y reiniciar Vite.
- **Error de inicio de sesión:** verificar Email/Password y las credenciales en Authentication.
- **Perfil pendiente:** comprobar que `usuarios/{uid}` existe, que el UID coincide y que el rol y `activo` tienen los valores indicados.
- **Error de consulta:** verificar la URL y que las reglas de `database.rules.json` estén publicadas en esa base de datos.

Referencia: [lectura y escritura con Firebase Realtime Database](https://firebase.google.com/docs/database/web/read-and-write).
