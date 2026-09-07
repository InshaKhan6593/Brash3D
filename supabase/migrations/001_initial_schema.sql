-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enum types
CREATE TYPE reserva_estado AS ENUM (
  'pendiente_pago',
  'confirmada',
  'cancelada',
  'completada'
);

CREATE TYPE sesion_estado AS ENUM (
  'en_progreso',
  'completada',
  'cancelada'
);

CREATE TYPE caja_estado AS ENUM (
  'pendiente',
  'empaquetada',
  'enviada',
  'entregada'
);

CREATE TYPE envio_estado AS ENUM (
  'preparacion',
  'en_transito',
  'en_aduanas',
  'entregado',
  'devuelto'
);

CREATE TYPE recompensa_estado AS ENUM (
  'pendiente',
  'aplicada',
  'vencida'
);

-- Tables

-- Clientes
CREATE TABLE clientes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  telefono VARCHAR(50) NOT NULL,
  pais VARCHAR(100) DEFAULT 'Colombia',
  ciudad VARCHAR(100),
  direccion TEXT,
  codigo_postal VARCHAR(20),
  numero_identificacion VARCHAR(50),
  referido_por_id UUID REFERENCES clientes(id),
  auth_user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_clientes_email ON clientes(email);
CREATE UNIQUE INDEX idx_clientes_telefono ON clientes(telefono);
CREATE INDEX idx_clientes_referido ON clientes(referido_por_id);

-- Equipos Locales
CREATE TABLE equipos_locales (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  ciudad VARCHAR(100),
  pais VARCHAR(100) DEFAULT 'Colombia',
  responsable VARCHAR(255),
  telefono VARCHAR(50),
  email VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Vendedores (staff)
CREATE TABLE vendedores (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  telefono VARCHAR(50),
  auth_user_id UUID,
  tienda_asignada VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_vendedores_email ON vendedores(email);

-- Disponibilidad (slots)
CREATE TABLE disponibilidad (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  vendedor_id UUID REFERENCES vendedores(id) NOT NULL,
  fecha DATE NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  disponible BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_disponibilidad_fecha ON disponibilidad(fecha);
CREATE INDEX idx_disponibilidad_vendedor ON disponibilidad(vendedor_id);
CREATE INDEX idx_disponibilidad_disponible ON disponibilidad(disponible);

-- Reservas
CREATE TABLE reservas (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  cliente_id UUID REFERENCES clientes(id) NOT NULL,
  disponibilidad_id UUID REFERENCES disponibilidad(id) NOT NULL,
  fecha_hora TIMESTAMP WITH TIME ZONE NOT NULL,
  estado reserva_estado DEFAULT 'pendiente_pago',
  payment_intent_id VARCHAR(255),
  monto_reserva DECIMAL(10, 2) DEFAULT 20.00,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_reservas_cliente ON reservas(cliente_id);
CREATE INDEX idx_reservas_disponibilidad ON reservas(disponibilidad_id);
CREATE INDEX idx_reservas_estado ON reservas(estado);
CREATE INDEX idx_reservas_fecha ON reservas(fecha_hora);

-- Sesiones de Compra
CREATE TABLE sesiones_compra (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  reserva_id UUID REFERENCES reservas(id) NOT NULL,
  vendedor_id UUID REFERENCES vendedores(id) NOT NULL,
  cliente_id UUID REFERENCES clientes(id) NOT NULL,
  fecha_inicio TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  fecha_fin TIMESTAMP WITH TIME ZONE,
  estado sesion_estado DEFAULT 'en_progreso',
  subtotal DECIMAL(10, 2) DEFAULT 0,
  impuesto DECIMAL(10, 2) DEFAULT 0,
  comision DECIMAL(10, 2) DEFAULT 0,
  total DECIMAL(10, 2) DEFAULT 0,
  payment_intent_65_id VARCHAR(255),
  payment_intent_35_id VARCHAR(255),
  monto_pagado_65 DECIMAL(10, 2) DEFAULT 0,
  monto_pagado_35 DECIMAL(10, 2) DEFAULT 0,
  whatsapp_thread_id VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sesiones_reserva ON sesiones_compra(reserva_id);
CREATE INDEX idx_sesiones_vendedor ON sesiones_compra(vendedor_id);
CREATE INDEX idx_sesiones_cliente ON sesiones_compra(cliente_id);
CREATE INDEX idx_sesiones_estado ON sesiones_compra(estado);

-- Productos en Carrito
CREATE TABLE productos_carrito (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  sesion_id UUID REFERENCES sesiones_compra(id) NOT NULL,
  nombre_producto VARCHAR(255) NOT NULL,
  sku VARCHAR(100),
  precio_unitario DECIMAL(10, 2) NOT NULL,
  cantidad INTEGER DEFAULT 1,
  precio_total DECIMAL(10, 2) NOT NULL,
  notas_vendedor TEXT,
  url_imagen TEXT,
  added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_productos_sesion ON productos_carrito(sesion_id);

-- Cajas Consolidadas
CREATE TABLE cajas_consolidadas (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  sesiones_ids UUID[] DEFAULT '{}',
  equipo_local_id UUID REFERENCES equipos_locales(id),
  numero_caja VARCHAR(50) NOT NULL,
  peso_kg DECIMAL(10, 2),
  valor_declarado DECIMAL(10, 2) DEFAULT 0,
  fecha_empaquetado TIMESTAMP WITH TIME ZONE,
  estado caja_estado DEFAULT 'pendiente',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_cajas_equipo ON cajas_consolidadas(equipo_local_id);
CREATE INDEX idx_cajas_estado ON cajas_consolidadas(estado);
CREATE INDEX idx_cajas_numero ON cajas_consolidadas(numero_caja);

-- Envios
CREATE TABLE envios (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  caja_id UUID REFERENCES cajas_consolidadas(id) NOT NULL,
  tracking_number VARCHAR(100),
  transportadora VARCHAR(255),
  fecha_envio TIMESTAMP WITH TIME ZONE,
  fecha_entrega_estimada TIMESTAMP WITH TIME ZONE,
  fecha_entrega_real TIMESTAMP WITH TIME ZONE,
  estado envio_estado DEFAULT 'preparacion',
  costo_envio DECIMAL(10, 2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_envios_caja ON envios(caja_id);
CREATE INDEX idx_envios_tracking ON envios(tracking_number);
CREATE INDEX idx_envios_estado ON envios(estado);

-- Referidos y Recompensas
CREATE TABLE referidos_recompensas (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  referidor_id UUID REFERENCES clientes(id) NOT NULL,
  referido_id UUID REFERENCES clientes(id) NOT NULL,
  reserva_aplicada_id UUID REFERENCES reservas(id),
  monto_recompensa DECIMAL(10, 2) DEFAULT 20.00,
  estado recompensa_estado DEFAULT 'pendiente',
  fecha_expiracion TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_referidos_referido ON referidos_recompensas(referido_id);
CREATE INDEX idx_referidos_referidor ON referidos_recompensas(referidor_id);
CREATE INDEX idx_referidos_estado ON referidos_recompensas(estado);

-- Transaction Logs for payments
CREATE TABLE payment_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  payment_intent_id VARCHAR(255) NOT NULL,
  reserva_id UUID REFERENCES reservas(id),
  sesion_id UUID REFERENCES sesiones_compra(id),
  monto DECIMAL(10, 2) NOT NULL,
  tipo_pago VARCHAR(50),
  estado VARCHAR(50) NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_payment_logs_intent ON payment_logs(payment_intent_id);
CREATE INDEX idx_payment_logs_reserva ON payment_logs(reserva_id);
CREATE INDEX idx_payment_logs_sesion ON payment_logs(sesion_id);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_clientes_updated_at BEFORE UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reservas_updated_at BEFORE UPDATE ON reservas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sesiones_compra_updated_at BEFORE UPDATE ON sesiones_compra
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Stored Procedure: Reservar Slot (Atomic)
CREATE OR REPLACE FUNCTION reservar_slot(
  p_cliente_id UUID,
  p_disponibilidad_id UUID,
  p_fecha_hora TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
  reserva_id UUID,
  exito BOOLEAN,
  mensaje VARCHAR(255)
) AS $$
DECLARE
  v_disponible BOOLEAN;
  v_reserva_id UUID;
BEGIN
  -- Check availability and lock row
  SELECT disponible INTO v_disponible
  FROM disponibilidad
  WHERE id = p_disponibilidad_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      NULL::UUID,
      FALSE,
      'Slot no encontrado'::VARCHAR;
    RETURN;
  END IF;

  IF NOT v_disponible THEN
    RETURN QUERY SELECT
      NULL::UUID,
      FALSE,
      'Slot no disponible'::VARCHAR;
    RETURN;
  END IF;

  -- Mark as not available
  UPDATE disponibilidad
  SET disponible = FALSE
  WHERE id = p_disponibilidad_id;

  -- Create reservation
  INSERT INTO reservas (
    cliente_id,
    disponibilidad_id,
    fecha_hora,
    estado,
    monto_reserva
  ) VALUES (
    p_cliente_id,
    p_disponibilidad_id,
    p_fecha_hora,
    'pendiente_pago',
    20.00
  )
  RETURNING id INTO v_reserva_id;

  RETURN QUERY SELECT
    v_reserva_id,
    TRUE,
    'Reserva creada exitosamente'::VARCHAR;
END;
$$ LANGUAGE plpgsql;

-- Real-time publication
CREATE PUBLICATION supabase_realtime FOR TABLE
  sesiones_compra,
  productos_carrito,
  reservas,
  envios;
