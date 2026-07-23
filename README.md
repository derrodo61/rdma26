# rdma26

rdma26 is a local-first, multi-agent personal AI assistant built with Angular,
Fastify, and the TypeScript Deep Agents SDK.

Agents can have distinct identities, models, capabilities, conversations, and
scoped memory. The Angular UI, API, and CLI share one backend runtime so core
behavior remains consistent across interfaces.

## Project Status

rdma26 is in early development. The current focus is making the assistant
dependable across ordinary questions, research, calculations, multi-step work,
and memory while keeping its evidence, model usage, latency, and cost
inspectable.

- [Product vision](./docs/product/vision.md)
- [Current milestone](./docs/product/current-milestone.md)
- [Complete documentation wiki](./docs/README.md)

## Quick Start

```bash
npm install
cp .env.example .env
npm run server
npm start
```

Open `http://localhost:4200`.

See [local development](./docs/development/local-development.md) for
authentication, model configuration, and local-network access.

## Documentation

- [Wiki home](./docs/README.md)
- [Architecture](./docs/architecture/README.md)
- [API reference](./docs/reference/api.md)
- [CLI reference](./docs/reference/cli.md)
- [Changelog](./CHANGELOG.md)

## License

This repository is public, but it is not open source. The code is
source-available for reference only. Copying, modifying, distributing, hosting,
or using it requires prior written permission from Rolf Dohrmann. See
[LICENSE](./LICENSE).
