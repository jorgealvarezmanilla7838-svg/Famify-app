// RNF31_ Aviso de privacidad conforme a la Ley Federal de Protección de Datos Personales
// en Posesión de los Particulares (LFPDPPP, México). Se muestra al registrarse y hay que aceptarlo.
//
// Los datos del responsable se pueden cambiar sin tocar el código, con variables en client/.env:
//   VITE_AVISO_RESPONSABLE, VITE_AVISO_DOMICILIO y VITE_AVISO_CORREO
const responsable =
  import.meta.env.VITE_AVISO_RESPONSABLE || 'Equipo del proyecto Famify, Universidad de Guadalajara (CUCEI)';
const domicilio =
  import.meta.env.VITE_AVISO_DOMICILIO ||
  'Blvd. Marcelino García Barragán 1421, esq. Calzada Olímpica, C.P. 44430, Guadalajara, Jalisco, México';
const correo: string | undefined = import.meta.env.VITE_AVISO_CORREO || undefined;

export const AvisoPrivacidad = () => (
  <details className="aviso-privacidad">
    <summary>Leer aviso de privacidad</summary>
    <p><strong>Responsable.</strong> {responsable} es responsable del tratamiento de tus datos personales. Domicilio: {domicilio}.</p>
    <p><strong>Datos que recabamos.</strong> Nombre, correo electrónico, información de ingresos y gastos, metas de ahorro, y los días de corte y de pago de tu tarjeta de crédito. Famify no guarda números de tarjeta ni códigos de seguridad.</p>
    <p><strong>Finalidades.</strong> Crear tu cuenta, administrar las finanzas de tu familia, generar reportes y enviarte recordatorios. Los integrantes de tu familia pueden ver la información que la aplicación comparte según su rol.</p>
    <p><strong>Transferencias.</strong> No compartimos tus datos con terceros, salvo que la ley lo exija.</p>
    <p>
      <strong>Derechos ARCO.</strong> Puedes acceder, rectificar, cancelar u oponerte al tratamiento de tus datos
      conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares.
      Acceso: consulta tus registros y reportes dentro de la aplicación. Rectificación: edita tus datos en
      “Mi configuración”. Cancelación: elimina tu cuenta en la sección Familia, opción “Darme de baja”; tus datos
      personales se borran o se anonimizan.
      {correo ? <> También puedes escribir a {correo}.</> : null}
    </p>
    <p><strong>Cambios.</strong> Cualquier cambio a este aviso se publicará en la aplicación. Última actualización: 16/11/2026.</p>
  </details>
);
