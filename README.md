# DevFlow — Multi-Tenant Engineering Project Management Platform

A portfolio-grade full-stack SaaS project demonstrating multi-tenancy, RBAC, JWT authentication, real-time updates, Redis caching, background jobs, PostgreSQL, Docker, testing, and API documentation.

## Stack
- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + TypeScript
- Database: PostgreSQL + Prisma
- Cache / jobs: Redis + BullMQ
- Realtime: Socket.IO
- Auth: JWT access/refresh tokens
- Docs: Swagger/OpenAPI
- Tests: Jest + Supertest
- Deployment: Docker + GitHub Actions

## Quick start

1. Copy environment files:
   - `cp backend/.env.example backend/.env`
   - `cp frontend/.env.example frontend/.env`
2. Start services:
   - `docker compose up --build`
3. Backend:
   - http://localhost:5000
   - Swagger: http://localhost:5000/api/docs
4. Frontend:
   - http://localhost:5173

## Demo account
Seed data creates:
- Email: demo@devflow.local
- Password: Password123!
