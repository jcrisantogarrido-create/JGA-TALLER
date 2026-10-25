// Campos del formulario de proveedor (alta y edición)
export default function CamposProveedor({ p = {} }: { p?: Record<string, unknown> }) {
  const v = (k: string) => (p[k] == null ? "" : String(p[k]));
  return (
    <div className="fields">
      <div className="field wide"><label htmlFor="pv-nombre">Nombre</label><input id="pv-nombre" name="nombre" required defaultValue={v("nombre")} placeholder="Refaccionaria del Norte" /></div>
      <div className="field"><label htmlFor="pv-doc">RFC / RUC</label><input id="pv-doc" name="documento_fiscal" defaultValue={v("documento_fiscal")} /></div>
      <div className="field"><label htmlFor="pv-contacto">Contacto</label><input id="pv-contacto" name="contacto" defaultValue={v("contacto")} placeholder="Nombre del vendedor" /></div>
      <div className="field"><label htmlFor="pv-tel">Teléfono / WhatsApp</label><input id="pv-tel" name="telefono" type="tel" defaultValue={v("telefono")} /></div>
      <div className="field"><label htmlFor="pv-email">Correo</label><input id="pv-email" name="email" type="email" defaultValue={v("email")} /></div>
      <div className="field"><label htmlFor="pv-pago">Condiciones de pago</label><input id="pv-pago" name="condiciones_pago" defaultValue={v("condiciones_pago")} placeholder="Contado, 30 días…" /></div>
      <div className="field"><label htmlFor="pv-dias">Días de entrega</label><input id="pv-dias" name="dias_entrega" inputMode="numeric" defaultValue={v("dias_entrega")} placeholder="2" /></div>
      <div className="field wide"><label htmlFor="pv-dir">Dirección</label><input id="pv-dir" name="direccion" defaultValue={v("direccion")} /></div>
    </div>
  );
}
