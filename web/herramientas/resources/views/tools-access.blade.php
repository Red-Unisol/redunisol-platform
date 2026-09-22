<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Acceso a herramientas</title>
        <style>
            :root {
                color-scheme: light;
                font-family: Arial, Helvetica, sans-serif;
                --border: #cbd5e1;
                --ink: #0f172a;
                --muted: #64748b;
                --primary: #075985;
                --danger: #b91c1c;
                --surface: #f8fafc;
            }

            body {
                background: var(--surface);
                color: var(--ink);
                margin: 0;
            }

            main {
                align-items: center;
                display: flex;
                min-height: 100vh;
                padding: 24px;
            }

            section {
                background: white;
                border: 1px solid var(--border);
                border-radius: 8px;
                margin: 0 auto;
                max-width: 420px;
                padding: 28px;
                width: 100%;
            }

            h1 {
                font-size: 24px;
                margin: 0 0 8px;
            }

            p {
                color: var(--muted);
                line-height: 1.5;
                margin: 0 0 20px;
            }

            label {
                display: block;
                font-size: 14px;
                font-weight: 700;
                margin-bottom: 8px;
            }

            input {
                border: 1px solid var(--border);
                border-radius: 8px;
                box-sizing: border-box;
                font: inherit;
                padding: 12px;
                width: 100%;
            }

            button {
                background: var(--primary);
                border: 0;
                border-radius: 8px;
                color: white;
                cursor: pointer;
                font: inherit;
                font-weight: 700;
                margin-top: 16px;
                padding: 12px 16px;
                width: 100%;
            }

            .alert {
                border-radius: 8px;
                margin-bottom: 16px;
                padding: 12px;
            }

            .alert-danger {
                background: #fee2e2;
                color: var(--danger);
            }
        </style>
    </head>
    <body>
        <main>
            <section>
                <h1>Herramientas Red Unisol</h1>
                <p>Ingrese la clave de acceso para operar las herramientas internas.</p>

                @if ($configurationMissing ?? false)
                    <div class="alert alert-danger">
                        Falta configurar <strong>HERRAMIENTAS_ACCESS_PASSWORD_HASH</strong> en el ambiente.
                    </div>
                @endif

                @error('password')
                    <div class="alert alert-danger">{{ $message }}</div>
                @enderror

                <form method="POST" action="{{ route('tools.access.login') }}">
                    @csrf
                    <label for="password">Clave</label>
                    <input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
                    <button type="submit">Ingresar</button>
                </form>
            </section>
        </main>
    </body>
</html>
