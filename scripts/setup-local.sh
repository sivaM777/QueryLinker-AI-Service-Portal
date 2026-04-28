#!/bin/bash
set -e

echo "🔧 Setting up local development environment..."

# Frontend
echo "📦 Installing frontend dependencies..."
cd frontend
npm install
cd ..

# Backend
echo "📦 Installing backend dependencies..."
cd backend
npm install
cd ..

# AI Service
echo "🤖 Installing AI service dependencies..."
cd ai-services/nlp-classifier
pip install -r requirements.txt
cd ../..

# Env files
if [ ! -f .env ]; then
  cp .env.example .env
  echo "📄 Copied .env.example to .env"
fi

echo "✅ Local setup complete."
echo ""
echo "Next steps:"
echo "  1) Start PostgreSQL or use SQLite for quick start"
echo "  2) Run 'npm run dev' in backend/"
echo "  3) Run 'npm run dev' in frontend/"
echo "  4) Run 'uvicorn app:app' in ai-services/nlp-classifier/"
echo ""
echo "Or use Docker Compose:"
echo "  docker-compose up -d"
