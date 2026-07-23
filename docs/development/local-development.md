# Local Development

**Status:** Current workflow
**Audience:** Contributors
**Canonical for:** Installing, configuring, and running rdma26 locally

## Requirements

- Node.js and npm
- A local checkout of the repository
- An OpenAI API key only when using OpenAI API-backed model features

## Install And Run

```bash
npm install
cp .env.example .env
npm run server
npm start
```

Open `http://localhost:4200`.

Without `OPENAI_API_KEY`, the backend still starts and stores messages, but
agent replies use a local fallback. Add the key to `.env` and restart the
backend to run Deep Agents through OpenAI.

## Optional Authentication

Set all three values in `.env` to enable the single-user login:

```bash
RDMA26_USERNAME=username
RDMA26_PASSWORD=userpassword
RDMA26_SESSION_SECRET=use-a-long-random-string
```

When credentials are configured, the backend protects `/api/*` with an
HTTP-only signed session cookie. Leave the username or password empty to run
without authentication.

## Local Network Access

To expose the development servers on the local network:

```bash
npm run server:lan
npm run start:lan
```

Then open `http://<computer-lan-ip>:4200` from another device.

## Useful Entry Points

- Angular UI: `http://localhost:4200`
- Backend: `http://localhost:3000`
- Interactive API documentation: `http://localhost:3000/docs`
- CLI: `./bin/rdma26 <command>`

## Related Pages

- [Testing and verification](./testing.md)
- [Architecture overview](../architecture/README.md)
- [API reference](../reference/api.md)
- [CLI reference](../reference/cli.md)
