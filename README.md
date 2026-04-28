# AI-IT Ticketing System

Enterprise-grade IT ticketing portal with AI-powered classification, intelligent routing, and self-service knowledge base.

## Architecture Overview

- **Frontend**: React + TypeScript, role-based UI (Employee/Admin)
- **Backend**: Modular API (FastAPI/Node), services, middleware, audit
- **AI Services**: Isolated NLP classifier (Python)
- **Infrastructure**: Docker Compose, Nginx, monitoring

## Quick Start

```bash
# Clone and set up
git clone <repo>
cd ai-it-ticketing-system

# Local dev
./scripts/setup-local.sh

# Run all services
docker-compose up -d
```

## Documentation

- `docs/architecture/` – system diagrams and data flow
- `docs/api/` – API specifications
- `docs/security/` – auth and roles
- `docs/deployment/` – deployment guide

## Modules

- `frontend/` – React app (role-based layouts, modules, services)
- `backend/` – API, models, services, middleware, events
- `ai-services/` – NLP classifier (Python)
- `infra/` – Dockerfiles, Nginx, monitoring
- `scripts/` – automation (migrate, seed, setup)
