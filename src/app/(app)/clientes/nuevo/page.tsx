import type { Metadata } from "next";
import Link from "next/link";
import FormCliente from "@/components/FormCliente";
import { requierePerfil } from "@/lib/sesion";
import { crearCliente } from "../actions";

export const metadata: Metadata = { title: "Nuevo cliente" };

export default async function NuevoClientePage() {
  await requierePerfil(["admin", "gerente", "recepcion"]);
  return (
    <>
      <div className="head">
        <div>
          <p className="sub"><Link href="/clientes">Clientes</Link> /</p>
          <h1>Nuevo cliente</h1>
        </div>
      </div>
      <section className="panel">
        <FormCliente accion={crearCliente} conVehiculo textoBoton="Registrar cliente" />
      </section>
    </>
  );
}
