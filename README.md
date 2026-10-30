# Aragon AI — Image Upload & Validation Platform

A full-stack web application for uploading, validating, and managing images with AI-powered quality checks.

## Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- npm or yarn

### 1. Start Infrastructure
```bash
docker-compose up -d
```
This starts PostgreSQL, Redis, and MinIO.

### 2. Setup Backend
```bash
cd server
npm install
npx prisma migrate dev
npm run dev
```

### 3. Setup Frontend
```bash
cd client
npm install
npm run dev
```

### 4. Access
- **Frontend**: http://localhost:4000
- **Backend API**: http://localhost:8080
- **MinIO Console**: http://localhost:9001 (minioadmin / minioadmin123)

## Architecture
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Backend**: Express + TypeScript + Prisma
- **Database**: PostgreSQL 16
- **Storage**: MinIO (S3-compatible)
- **Queue**: BullMQ + Redis
- **Processing**: Sharp + face-api.js
