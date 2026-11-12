// Permisos del sistema (RF038 / RF039).
// Son los mismos que valida rolfamiliar.permisos en la base de datos (fn_permisos_validos),
// así que no se puede inventar uno que la base no conozca.
export interface DefinicionPermiso {
  clave: string;
  descripcion: string;
}

export const PERMISOS: DefinicionPermiso[] = [
  { clave: 'ingresos.registrar', descripcion: 'Registrar ingresos' },
  { clave: 'ingresos.editar', descripcion: 'Editar y eliminar sus ingresos' },
  { clave: 'gastos.registrar', descripcion: 'Registrar gastos' },
  { clave: 'gastos.editar', descripcion: 'Editar y eliminar sus gastos' },
  { clave: 'gastos.ver_detalle', descripcion: 'Ver el detalle de los gastos de los demás integrantes' },
  { clave: 'presupuesto.gestionar', descripcion: 'Crear y modificar presupuestos' },
  { clave: 'metas.gestionar', descripcion: 'Crear y modificar metas de ahorro' },
  { clave: 'metas.aportar', descripcion: 'Registrar aportaciones a las metas' },
  { clave: 'reportes.ver', descripcion: 'Ver el resumen financiero y los reportes' },
  { clave: 'familia.invitar', descripcion: 'Invitar nuevos integrantes' },
  { clave: 'familia.administrar', descripcion: 'Administrar integrantes, roles y permisos' },
];

export const CLAVES_PERMISO = PERMISOS.map((p) => p.clave);

// Los dos últimos son exclusivos del administrador, no se pueden dar a un integrante
export const PERMISOS_EDITABLES = PERMISOS.filter((p) => !p.clave.startsWith('familia.'));
