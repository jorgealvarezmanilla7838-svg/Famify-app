// Se carga ANTES que cualquier módulo del servidor (node --import).
// Las pruebas unitarias nunca se conectan a PostgreSQL: todas las consultas se simulan en bd-falsa.ts.
// Por si alguna consulta se escapara, el pool apunta a un puerto donde no hay base de datos.
process.env.DB_PASSWORD = 'solo-pruebas';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '1';
process.env.DB_NAME = 'famify_pruebas_unitarias';
process.env.JWT_SECRET = 'secreto-de-pruebas-unitarias';
process.env.RESPALDOS_ACTIVOS = 'false';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.NODE_ENV = 'test';
delete process.env.TLS_OBLIGATORIO;
delete process.env.CLIENT_URL;
