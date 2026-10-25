import { TIPOS_VEHICULO } from "@/lib/tipos";

// Campos de vehículo reutilizados en "Nuevo cliente" y "Agregar vehículo"
export default function CamposVehiculo({ requerido = true, prefijo = "v" }: { requerido?: boolean; prefijo?: string }) {
  const id = (k: string) => `${prefijo}-${k}`;
  return (
    <div className="fields">
      <div className="field">
        <label htmlFor={id("placa")}>Placa</label>
        <input id={id("placa")} name="placa" required={requerido} autoCapitalize="characters" placeholder="ABC-123-D" />
      </div>
      <div className="field">
        <label htmlFor={id("marca")}>Marca</label>
        <input id={id("marca")} name="marca" required={requerido} placeholder="Nissan" list="marcas-comunes" />
      </div>
      <div className="field">
        <label htmlFor={id("modelo")}>Modelo</label>
        <input id={id("modelo")} name="modelo" required={requerido} placeholder="Versa" />
      </div>
      <div className="field">
        <label htmlFor={id("anio")}>Año</label>
        <input id={id("anio")} name="anio" type="number" min={1950} max={2100} required={requerido} placeholder="2019" />
      </div>
      <div className="field">
        <label htmlFor={id("tipo")}>Tipo</label>
        <select id={id("tipo")} name="tipo_vehiculo" defaultValue="sedan">
          {Object.entries(TIPOS_VEHICULO).map(([v, t]) => (
            <option key={v} value={v}>{t}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={id("color")}>Color</label>
        <input id={id("color")} name="color" />
      </div>
      <div className="field">
        <label htmlFor={id("km")}>Kilometraje</label>
        <input id={id("km")} name="kilometraje_actual" inputMode="numeric" placeholder="42 000" />
      </div>
      <div className="field">
        <label htmlFor={id("vin")}>VIN (opcional)</label>
        <input id={id("vin")} name="vin" maxLength={17} autoCapitalize="characters" />
      </div>
      <datalist id="marcas-comunes">
        {["Nissan", "Volkswagen", "Chevrolet", "Toyota", "Honda", "Mazda", "Kia", "Hyundai", "Ford", "Suzuki", "BMW", "Mercedes-Benz", "Audi", "SEAT", "Renault", "MG"].map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </div>
  );
}
