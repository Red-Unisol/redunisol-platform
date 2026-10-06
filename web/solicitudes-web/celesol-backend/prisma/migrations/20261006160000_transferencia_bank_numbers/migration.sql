CREATE SEQUENCE transferencia_identificadores_numero_seq
    AS BIGINT MINVALUE 1 MAXVALUE 9999999999999 NO CYCLE;
CREATE TABLE transferencia_identificadores (
    numero BIGINT PRIMARY KEY DEFAULT nextval('transferencia_identificadores_numero_seq'),
    solicitud_id UUID NOT NULL REFERENCES solicitudes(id) ON DELETE RESTRICT,
    payment_key TEXT NOT NULL,
    UNIQUE (solicitud_id, payment_key)
);
ALTER SEQUENCE transferencia_identificadores_numero_seq
    OWNED BY transferencia_identificadores.numero;
CREATE FUNCTION preserve_transferencia_identificador() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Los identificadores bancarios son permanentes y no se reciclan';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER transferencia_identificadores_immutable
    BEFORE UPDATE OR DELETE ON transferencia_identificadores
    FOR EACH ROW EXECUTE FUNCTION preserve_transferencia_identificador();
