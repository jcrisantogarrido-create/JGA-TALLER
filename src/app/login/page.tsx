import type { Metadata } from "next";
import FormLogin from "./FormLogin";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ siguiente?: string }>;
}) {
  const { siguiente = "/" } = await searchParams;
  return (
    <main className="login">
      <div className="card">
        <div className="brand">
          Taller <span>JGA</span>
        </div>
        <p className="muted">Entra con la cuenta que te dio administración.</p>
        <FormLogin siguiente={siguiente} />
      </div>
    </main>
  );
}
