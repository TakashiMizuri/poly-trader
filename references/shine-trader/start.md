# Shine Trader — how to run locally

The repository contains two applications:

| Folder | Stack | Default URL |
|--------|--------|-------------|
| `shine-trader-server` | ASP.NET Core (.NET 10), PostgreSQL, EF Core | http://localhost:5088 |
| `shine-trader-client` | React 19, Vite 7, TypeScript | http://localhost:3000 |

Run the **database**, then the **server**, then the **client**.

---

## Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Node.js](https://nodejs.org/) (LTS recommended) with `npm`
- [PostgreSQL](https://www.postgresql.org/) (local instance)

Optional:

- [EF Core tools](https://learn.microsoft.com/en-us/ef/core/cli/dotnet) for applying migrations:

  ```bash
  dotnet tool install --global dotnet-ef
  ```

---

## 1. PostgreSQL

1. Start PostgreSQL on your machine.
2. Create the database (name must match the connection string):

   ```sql
   CREATE DATABASE "shine-trader";
   ```

3. Adjust credentials if needed in `shine-trader-server/appsettings.Development.json`:

   ```json
   "DefaultConnection": "Host=localhost;Port=5432;Database=shine-trader;Username=postgres;Password=admin;Timezone=UTC"
   ```

4. Apply EF Core migrations from the server project directory:

   ```bash
   cd shine-trader-server
   dotnet ef database update
   ```

   Migrations live in `shine-trader-server/data/Migrations/`.

---

## 2. Backend (API)

From the repository root:

```bash
cd shine-trader-server
dotnet restore
dotnet run
```

- HTTP: **http://localhost:5088**
- In Development, Swagger UI is available (typically at `/swagger`).
- CORS allows the React app at `http://localhost:3000`.

Other profiles (see `Properties/launchSettings.json`):

```bash
dotnet run --launch-profile http
dotnet run --launch-profile https   # also exposes https://localhost:7165
```

---

## 3. Frontend

In a **second terminal**, from the repository root:

```bash
cd shine-trader-client
npm install
npm run dev
```

- Dev server: **http://localhost:3000** (configured in `vite.config.ts`; browser may open automatically).
- The client calls the API at `http://localhost:5088/api` (see `src/services/api/config.ts`). Keep the backend on port **5088** or update those URLs.

Other scripts:

```bash
npm run build    # production build to dist/
npm run preview  # preview production build
npm run lint     # ESLint
```

---

## 4. Verify

1. Open http://localhost:3000 — UI should load.
2. Open http://localhost:5088/swagger — API docs (Development only).
3. If the UI cannot reach the API, check that both processes are running and that PostgreSQL is up with migrations applied.

---

## Tests (optional)

```bash
cd shine-trader-server/tests/shine-trader-server.tests
dotnet test
```

---

## Typical dev workflow

1. Start PostgreSQL.
2. Terminal 1: `cd shine-trader-server && dotnet run`
3. Terminal 2: `cd shine-trader-client && npm run dev`
4. Work in the browser at http://localhost:3000.

---

## Troubleshooting

| Issue | What to check |
|-------|----------------|
| DB connection errors | PostgreSQL running, database `shine-trader` exists, credentials in `appsettings.Development.json` |
| Missing tables | Run `dotnet ef database update` in `shine-trader-server` |
| CORS / API errors from UI | Backend on port 5088; frontend on port 3000 |
| Port 3000 in use | Change `server.port` in `shine-trader-client/vite.config.ts` and update CORS in `shine-trader-server/Program.cs` if you use another port |
| `dotnet ef` not found | Install global tool: `dotnet tool install --global dotnet-ef` |
