import { ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

import { LoginForm } from "@/modules/auth/components/login-form";

export function LoginPage() {
  return (
    <section className="w-full max-w-[430px]">
      <div className="mx-auto mb-4 flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
        <ShieldCheck className="size-4.5" />
      </div>

      <div className="rounded-md border border-border bg-surface px-6 py-5 shadow-[0_4px_10px_rgba(0,0,0,0.07)]">
        <header className="mb-5">
          <h1 className="text-center text-[1.85rem] leading-tight font-semibold text-foreground">
            Iniciar sesión
          </h1>
          <p className="mt-2 text-center text-sm text-foreground-secondary">
            Ingrese su nombre de usuario o correo y contraseña para ingresar.
          </p>
        </header>

        <LoginForm />

        <div className="mt-5 flex items-center justify-between text-sm">
          <Link className="text-primary hover:underline" to="/register">
            Crear cuenta
          </Link>
          <Link className="text-primary hover:underline" to="/forgot-password">
            Olvidé mi contraseña
          </Link>
        </div>

        <div className="mt-5 border-t border-border pt-4 text-center text-xs text-foreground-muted">
          Al continuar, aceptas nuestros términos y políticas de privacidad.
        </div>
      </div>

      <p className="mt-6 text-center text-sm text-foreground-secondary">
        ¿Necesitas ayuda técnica?{" "}
        <a className="underline underline-offset-2" href="#">
          Contactar a soporte
        </a>
      </p>
    </section>
  );
}
